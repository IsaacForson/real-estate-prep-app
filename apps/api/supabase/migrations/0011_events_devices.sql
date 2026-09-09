-- 0011_events_devices.sql
-- V2_PLAN §1 "device tracking" + §2:
--   events              — everything a learner did, client- and server-emitted; the admin console's timeline
--   device_fingerprints — one row per device hash across *all* accounts (the abuse signal the per-account
--                         `devices` table cannot see): which accounts used it, blocked / exhausted flags
--   free_tier_usage     — questions / mocks consumed per (user | device, jurisdiction). a device inherits
--                         max(user, device) so "clear storage + new email" gets no extra free questions.

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete set null,   -- null for anonymous pre-sign-in events
  device_hash  text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  kind         text not null check (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  props        jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object'),
  -- when the client says it happened (offline queue); created_at is when the server saw it.
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index events_user_created_idx on public.events (user_id, created_at desc);
create index events_kind_created_idx on public.events (kind, created_at desc);
create index events_device_created_idx on public.events (device_hash, created_at desc) where device_hash is not null;
create index events_created_idx on public.events (created_at desc);

alter table public.events enable row level security;

create policy "events: owner can read"
  on public.events for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
-- direct owner inserts allowed so the client can fall back to postgrest when track-event is unreachable.
create policy "events: owner can insert"
  on public.events for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- device_fingerprints (cross-account)
-- ---------------------------------------------------------------------------
create table public.device_fingerprints (
  device_hash             text primary key check (device_hash ~ '^[0-9a-f]{64}$'),
  platform                public.device_platform,
  model                   text check (char_length(model) <= 120),
  first_seen              timestamptz not null default now(),
  last_seen               timestamptz not null default now(),
  -- every account that ever sent this hash (append-only, distinct).
  account_ids             uuid[] not null default '{}'::uuid[],
  -- (account id, first time it appeared on this device) — the 30-day window needs the timestamps.
  account_history         jsonb not null default '[]'::jsonb check (jsonb_typeof(account_history) = 'array'),
  blocked                 boolean not null default false,
  -- set by fn_touch_device_fingerprint when >= 3 accounts in 30 days: no free tier for *new* accounts.
  free_tier_exhausted_at  timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index device_fingerprints_flagged_idx on public.device_fingerprints (last_seen desc)
  where blocked or free_tier_exhausted_at is not null or cardinality(account_ids) >= 3;

create trigger device_fingerprints_set_updated_at
  before update on public.device_fingerprints
  for each row execute function public.fn_set_updated_at();

alter table public.device_fingerprints enable row level security;
-- service role + admins only. a learner must not be able to see which other accounts used their device.
create policy "device_fingerprints: admin can read"
  on public.device_fingerprints for select to authenticated
  using (public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- free_tier_usage
-- ---------------------------------------------------------------------------
create table public.free_tier_usage (
  scope           text not null check (scope in ('user', 'device')),
  scope_id        text not null,                     -- user uuid as text, or the device hash
  jurisdiction    text not null check (jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  questions_used  int not null default 0 check (questions_used >= 0),
  mocks_used      int not null default 0 check (mocks_used >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (scope, scope_id, jurisdiction)
);

create trigger free_tier_usage_set_updated_at
  before update on public.free_tier_usage
  for each row execute function public.fn_set_updated_at();

alter table public.free_tier_usage enable row level security;

-- the user may read their own counters (useFreeTier hydrates from here); device rows stay hidden.
create policy "free_tier_usage: owner can read"
  on public.free_tier_usage for select to authenticated
  using ((scope = 'user' and scope_id = auth.uid()::text) or public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- V2_PLAN §1: "a device that has been used by >= 3 accounts in 30 days is flagged (anomaly_flags kind
-- device_accounts) and its free tier is exhausted for all new accounts." called by every device-aware
-- function after auth. appends the account, bumps last_seen, evaluates the rule. returns the row state
-- the caller needs to decide the free tier.
create or replace function public.fn_touch_device_fingerprint(
  p_device_hash text,
  p_user_id     uuid,
  p_platform    public.device_platform default null,
  p_model       text default null
)
returns table (account_count int, accounts_30d int, blocked boolean, exhausted boolean, flagged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        public.device_fingerprints%rowtype;
  v_is_new     boolean := false;
  v_30d        int;
  v_flag       uuid;
  v_flagged    boolean := false;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'device_hash must be sha256 hex' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('device_fp:' || p_device_hash));

  insert into public.device_fingerprints (device_hash, platform, model)
  values (p_device_hash, p_platform, p_model)
  on conflict (device_hash) do nothing;

  select * into v_row from public.device_fingerprints where device_hash = p_device_hash for update;

  if p_user_id is not null and not (p_user_id = any (v_row.account_ids)) then
    v_is_new := true;
    v_row.account_ids := v_row.account_ids || p_user_id;
    v_row.account_history := v_row.account_history
      || jsonb_build_array(jsonb_build_object('user_id', p_user_id, 'at', now()));
  end if;

  -- accounts whose *first* appearance on this device is inside the trailing 30 days.
  select count(*)::int into v_30d
  from jsonb_array_elements(v_row.account_history) h
  where (h->>'at')::timestamptz > now() - interval '30 days';

  if v_30d >= 3 and v_row.free_tier_exhausted_at is null then
    v_row.free_tier_exhausted_at := now();
  end if;

  update public.device_fingerprints d
  set account_ids            = v_row.account_ids,
      account_history        = v_row.account_history,
      last_seen              = now(),
      platform               = coalesce(p_platform, d.platform),
      model                  = coalesce(p_model, d.model),
      free_tier_exhausted_at = v_row.free_tier_exhausted_at
  where d.device_hash = p_device_hash;

  -- flag the account that just crossed (or is using) a shared device. fn_open_anomaly_flag dedupes
  -- per kind per 7 days and queues the re-verification email (soft response, SPEC §5.3).
  if v_30d >= 3 and p_user_id is not null and v_is_new then
    v_flag := public.fn_open_anomaly_flag(p_user_id, 'device_accounts',
      jsonb_build_object('device_hash', p_device_hash, 'accounts_30d', v_30d, 'accounts_total', cardinality(v_row.account_ids)));
    v_flagged := v_flag is not null;
  end if;

  if v_is_new then
    insert into public.events (user_id, device_hash, kind, props)
    values (p_user_id, p_device_hash, 'device_seen',
      jsonb_build_object('platform', p_platform, 'accounts_total', cardinality(v_row.account_ids), 'accounts_30d', v_30d));
  end if;

  return query select cardinality(v_row.account_ids)::int, v_30d, v_row.blocked,
                      (v_row.free_tier_exhausted_at is not null), v_flagged;
end;
$$;

-- device-level free-tier view for the edge functions: what this device has consumed in a jurisdiction
-- plus its flags. never exposed to clients directly (service role only).
create or replace function public.fn_device_free_tier(p_device_hash text, p_jurisdiction text)
returns table (questions_used int, mocks_used int, blocked boolean, exhausted boolean, account_count int)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.questions_used, 0), coalesce(u.mocks_used, 0),
         coalesce(d.blocked, false), (d.free_tier_exhausted_at is not null),
         coalesce(cardinality(d.account_ids), 0)
  from (select 1) one
  left join public.device_fingerprints d on d.device_hash = p_device_hash
  left join public.free_tier_usage u
         on u.scope = 'device' and u.scope_id = p_device_hash and u.jurisdiction = p_jurisdiction
  where public.fn_is_service_role();
$$;

-- add consumed questions / mocks to both scopes at once. idempotency is the caller's job (called once
-- per issued batch / started mock).
create or replace function public.fn_bump_free_tier_usage(
  p_user_id      uuid,
  p_device_hash  text,
  p_jurisdiction text,
  p_questions    int default 0,
  p_mocks        int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  if p_user_id is not null then
    insert into public.free_tier_usage (scope, scope_id, jurisdiction, questions_used, mocks_used)
    values ('user', p_user_id::text, p_jurisdiction, greatest(0, p_questions), greatest(0, p_mocks))
    on conflict (scope, scope_id, jurisdiction) do update
      set questions_used = public.free_tier_usage.questions_used + excluded.questions_used,
          mocks_used     = public.free_tier_usage.mocks_used + excluded.mocks_used;
  end if;
  if p_device_hash is not null then
    insert into public.free_tier_usage (scope, scope_id, jurisdiction, questions_used, mocks_used)
    values ('device', p_device_hash, p_jurisdiction, greatest(0, p_questions), greatest(0, p_mocks))
    on conflict (scope, scope_id, jurisdiction) do update
      set questions_used = public.free_tier_usage.questions_used + excluded.questions_used,
          mocks_used     = public.free_tier_usage.mocks_used + excluded.mocks_used;
  end if;
end;
$$;

-- user-scope counters, falling back to what item_batches already recorded before this migration
-- (so an existing free account does not get 40 fresh questions when v2 ships).
create or replace function public.fn_user_free_tier(p_user_id uuid, p_jurisdiction text)
returns table (questions_used int, mocks_used int)
language sql
stable
security definer
set search_path = public
as $$
  select greatest(coalesce(u.questions_used, 0), public.fn_items_delivered_count(p_user_id)),
         greatest(coalesce(u.mocks_used, 0), public.fn_mock_forms_started(p_user_id))
  from (select 1) one
  left join public.free_tier_usage u
         on u.scope = 'user' and u.scope_id = p_user_id::text and u.jurisdiction = p_jurisdiction
  where auth.uid() = p_user_id or public.fn_is_service_role();
$$;

revoke execute on function public.fn_touch_device_fingerprint(text, uuid, public.device_platform, text) from public, anon, authenticated;
revoke execute on function public.fn_device_free_tier(text, text) from public, anon, authenticated;
revoke execute on function public.fn_bump_free_tier_usage(uuid, text, text, int, int) from public, anon, authenticated;
