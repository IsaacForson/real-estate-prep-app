-- 0007_anomaly.sql
-- SPEC §5.3 anomaly detection, soft response. flag on:
--   * more than 3 distinct device fingerprints in 30 days
--   * logins from more than 3 geographic regions in 24 hours
--   * answer volume exceeding a plausible human ceiling
-- response: a re-verification email. never a silent ban. log everything, act conservatively.

-- coarse location observations (country/region from the edge headers). never the ip itself.
create table public.geo_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  region_key  text not null,           -- e.g. "US-FL", "GH", "unknown"
  source      text not null,           -- which function observed it: 'issue-batch' | 'sync-progress' | 'register-device'
  created_at  timestamptz not null default now()
);
create index geo_events_user_created_idx on public.geo_events (user_id, created_at desc);

alter table public.geo_events enable row level security;
-- service role only.

create table public.anomaly_flags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         public.anomaly_kind not null,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolution   text        -- 'reverified' | 'support_cleared' | 'false_positive'
);
create index anomaly_flags_user_open_idx on public.anomaly_flags (user_id, kind) where resolved_at is null;

alter table public.anomaly_flags enable row level security;

-- honest ux: the user can see why they were asked to re-verify.
create policy "anomaly_flags: owner can read"
  on public.anomaly_flags for select to authenticated
  using (user_id = auth.uid());

-- outbox for transactional email. the send itself is a todo in _shared/email.ts; a worker
-- (or a database webhook) picks up rows where sent_at is null.
create table public.email_outbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  template    text not null,           -- 'reverify_account' | 'device_removed' | ...
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
create index email_outbox_unsent_idx on public.email_outbox (created_at) where sent_at is null;

alter table public.email_outbox enable row level security;
-- service role only.

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- open a flag unless the same kind is already open (or was opened in the last 7 days), so a
-- flapping heuristic does not send a daily email. returns the new flag id or null if deduped.
create or replace function public.fn_open_anomaly_flag(
  p_user_id uuid,
  p_kind    public.anomaly_kind,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.anomaly_flags f
    where f.user_id = p_user_id and f.kind = p_kind
      and (f.resolved_at is null or f.created_at > now() - interval '7 days')
  ) then
    return null;
  end if;
  insert into public.anomaly_flags (user_id, kind, details)
  values (p_user_id, p_kind, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;

  insert into public.email_outbox (user_id, template, payload)
  values (p_user_id, 'reverify_account', jsonb_build_object('flag_id', v_id, 'kind', p_kind));

  perform public.fn_audit('system', p_user_id, 'anomaly.flagged', v_id::text,
    jsonb_build_object('kind', p_kind) || coalesce(p_details, '{}'::jsonb));
  return v_id;
end;
$$;

-- distinct fingerprints seen in the last 30 days (SPEC §5.3 threshold: > 3).
create or replace function public.fn_distinct_fingerprints_30d(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct d.fingerprint_hash)::int
  from public.devices d
  where d.user_id = p_user_id
    and d.last_seen > now() - interval '30 days';
$$;

-- distinct regions observed in the last 24 hours (SPEC §5.3 threshold: > 3). 'unknown' is
-- ignored so a missing header can never trigger a flag.
create or replace function public.fn_distinct_regions_24h(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct g.region_key)::int
  from public.geo_events g
  where g.user_id = p_user_id
    and g.region_key <> 'unknown'
    and g.created_at > now() - interval '24 hours';
$$;

-- the re-verification email link lands here (through the edge/api layer): clear open flags.
create or replace function public.fn_resolve_anomaly_flags(p_user_id uuid, p_resolution text default 'reverified')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();
  update public.anomaly_flags
  set resolved_at = now(), resolution = p_resolution
  where user_id = p_user_id and resolved_at is null;
  get diagnostics v_count = row_count;
  update public.profiles set last_reverified_at = now() where id = p_user_id;
  perform public.fn_audit('user', p_user_id, 'anomaly.resolved', null,
    jsonb_build_object('count', v_count, 'resolution', p_resolution));
  return v_count;
end;
$$;
