-- 0016_settings_refunds.sql
-- Three things the admin console needed and the schema could not express:
--
--   1. app_settings      — global, operator-editable product rules. Until now every rule was a
--                          constant compiled into both SQL and TypeScript, so changing "one device
--                          per account" meant a migration plus a function deploy. The device rule
--                          in particular is a policy call, not a law, and the person who has to
--                          answer the support ticket should be able to change it.
--   2. refund_requests   — refunds existed only as `entitlements.revoke_reason = 'refund'`, which
--                          is a side effect, not a record. There was nowhere to see who asked, on
--                          what grounds, what was decided, how much, or whether the money actually
--                          went back. The pass guarantee (SPEC §6) promises a refund on conditions
--                          nobody could check without reading four tables by hand.
--   3. impersonation     — an admin can now open the app as a user to reproduce a bug. The audit
--                          trail for that lives in admin_audit; what this file adds is the ability
--                          for such a session to exist without stealing the user's device slot.
--
-- Mirrored on the TypeScript side in supabase/functions/_shared/limits.ts (which now reads the
-- setting rather than hardcoding it) and _shared/device-rule.ts.

-- ---------------------------------------------------------------------------
-- app_settings: one row per rule, jsonb so a rule can grow fields without a migration.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table public.app_settings enable row level security;
create policy "app_settings: admin can read"
  on public.app_settings for select to authenticated
  using (public.fn_is_admin());
-- writes: service role only, through fn_set_app_setting.

insert into public.app_settings (key, value) values
  -- max_active_devices: how many devices may hold a live session at once. 1 means the newest
  -- sign-in takes the account over (0015). Above 1, older devices keep working until the ceiling
  -- is reached and only then does the oldest lose its slot.
  ('device_policy', '{"max_active_devices": 1}'::jsonb),
  -- content_sync: when the item/manifest pipeline last published, so the console can show it and
  -- an operator can force clients to refetch by bumping the epoch.
  ('content_sync', '{"epoch": 1, "last_synced_at": null}'::jsonb)
on conflict (key) do nothing;

-- read a setting. security definer so RLS does not hide it from the functions below, which run for
-- ordinary users (register-device is called by the learner, not by an admin).
create or replace function public.fn_app_setting(p_key text, p_default jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.value from public.app_settings s where s.key = p_key), p_default);
$$;

create or replace function public.fn_set_app_setting(p_key text, p_value jsonb)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_settings;
begin
  perform public.fn_assert_admin();
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'setting value must be a json object' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.fn_set_app_setting(text, jsonb) from public, anon;

-- The one rule that other functions branch on. Clamped so a bad value cannot unlock the account
-- ceiling entirely or lock everyone out.
create or replace function public.fn_max_active_devices()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(10,
    coalesce((public.fn_app_setting('device_policy', '{"max_active_devices": 1}'::jsonb) ->> 'max_active_devices')::int, 1)
  ));
$$;

-- The slice of app_settings a client is allowed to see. Two fields, both of which the app has to
-- act on: the device rule (the account screen explains it in words) and the content epoch (bumped
-- by an admin to tell every install its cached questions are stale and must be refetched).
create or replace view public.v_app_runtime
with (security_invoker = true) as
  select
    public.fn_max_active_devices() as max_active_devices,
    coalesce((public.fn_app_setting('content_sync', '{"epoch": 1}'::jsonb) ->> 'epoch')::int, 1) as content_epoch,
    (public.fn_app_setting('content_sync', '{}'::jsonb) ->> 'last_synced_at')::timestamptz as content_synced_at;
grant select on public.v_app_runtime to authenticated, anon;

-- Invalidate every install's cached items. The app compares the epoch it last saw against
-- v_app_runtime on boot and clears its local item cache when they differ, so the next session is
-- served fresh from issue-batch. Cheap and idempotent; the only cost of a needless bump is one
-- refetch per device.
create or replace function public.fn_bump_content_epoch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  perform public.fn_assert_admin();
  v_next := coalesce((public.fn_app_setting('content_sync', '{"epoch": 1}'::jsonb) ->> 'epoch')::int, 1) + 1;
  perform public.fn_set_app_setting('content_sync',
    jsonb_build_object('epoch', v_next, 'last_synced_at', to_jsonb(now())));
  return jsonb_build_object('epoch', v_next, 'last_synced_at', now());
end;
$$;
revoke execute on function public.fn_bump_content_epoch() from public, anon;

-- ---------------------------------------------------------------------------
-- device slots become policy-driven.
--
-- 0015 hardwired "retire everything else". Now we retire only what exceeds the ceiling, oldest
-- last_seen first, so raising the setting to 3 gives back the old three-slot behaviour without the
-- cooldown, and leaving it at 1 keeps the takeover rule the app ships with.
-- ---------------------------------------------------------------------------
create or replace function public.fn_enforce_device_limit(p_user_id uuid, p_keep uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max     int := public.fn_max_active_devices();
  v_retired int := 0;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  -- everything except the device signing in, newest first; anything past (max - 1) loses its slot.
  with ranked as (
    select d.id, row_number() over (order by d.last_seen desc nulls last, d.first_seen desc) as rn
    from public.devices d
    where d.user_id = p_user_id and d.removed_at is null and d.id <> p_keep
  ), doomed as (
    select id from ranked where rn > greatest(0, v_max - 1)
  )
  update public.devices d
  set removed_at = now(), cooldown_until = null
  where d.id in (select id from doomed);
  get diagnostics v_retired = row_count;

  -- a device without a slot cannot hold a session
  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id
    and s.revoked_at is null
    and s.device_id in (select d.id from public.devices d where d.user_id = p_user_id and d.removed_at is not null);

  if v_retired > 0 then
    perform public.fn_audit('user', p_user_id, 'device.superseded', p_keep::text,
      jsonb_build_object('retired_devices', v_retired, 'max_active_devices', v_max));
  end if;
  return v_retired;
end;
$$;

-- 0015's name, kept as a thin alias so anything still calling it keeps working.
create or replace function public.fn_retire_other_devices(p_user_id uuid, p_keep uuid)
returns int
language sql
volatile
security definer
set search_path = public
as $$
  select public.fn_enforce_device_limit(p_user_id, p_keep);
$$;

-- ---------------------------------------------------------------------------
-- sessions follow the same rule.
--
-- fn_start_session used to revoke *every* other session unconditionally, and fn_session_is_valid
-- required profiles.current_session_id to be this session. Both encoded "one live session" in a
-- place the setting could not reach, so raising max_active_devices would have let a second device
-- register and then immediately knocked it offline. Now they only single out a session when the
-- ceiling is 1.
-- ---------------------------------------------------------------------------
create or replace function public.fn_start_session(p_user_id uuid, p_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_revoked int := 0;
  v_max     int := public.fn_max_active_devices();
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  if not exists (select 1 from public.devices d where d.id = p_device_id and d.user_id = p_user_id and d.removed_at is null) then
    raise exception 'device not registered' using errcode = 'P0002';
  end if;

  -- always replace this device's own previous session; only clear the other devices' when the
  -- account is limited to a single live device.
  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id
    and s.revoked_at is null
    and (v_max <= 1 or s.device_id = p_device_id);
  get diagnostics v_revoked = row_count;

  insert into public.sessions (user_id, device_id) values (p_user_id, p_device_id)
  returning id into v_session;

  -- current_session_id is the "single live session" pointer. It stays meaningful at max = 1; above
  -- that it simply records the most recent sign-in and fn_session_is_valid stops requiring it.
  update public.profiles set current_session_id = v_session where id = p_user_id;

  perform public.fn_audit('user', p_user_id, 'session.started', v_session::text,
    jsonb_build_object('device_id', p_device_id, 'revoked_sessions', v_revoked, 'max_active_devices', v_max));
  return v_session;
end;
$$;

create or replace function public.fn_session_is_valid(p_user_id uuid, p_session_id uuid, p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    join public.profiles p on p.id = s.user_id
    join public.devices d on d.id = s.device_id
    where s.id = p_session_id
      and s.user_id = p_user_id
      and s.device_id = p_device_id
      and s.revoked_at is null
      and d.removed_at is null
      and (public.fn_max_active_devices() > 1 or p.current_session_id = s.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- register_device: same contract as 0015, but the slot ceiling is the setting, and an impersonated
-- session can opt out of taking a slot at all.
--
-- p_impersonated: an admin opening the app as this user must not sign the user out of their own
-- phone. Such a session is attached to the user's most recent device without registering a new one
-- and without retiring anything. It is audited by the caller (admin-api).
-- ---------------------------------------------------------------------------
drop function if exists public.fn_register_device(uuid, text, public.device_platform, text);
create function public.fn_register_device(
  p_user_id          uuid,
  p_fingerprint_hash text,
  p_platform         public.device_platform,
  p_name             text default null
)
returns table (device_id uuid, session_id uuid, created boolean, superseded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device     public.devices%rowtype;
  v_exists     boolean;
  v_created    boolean := false;
  v_session    uuid;
  v_superseded int := 0;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  -- serialise per user so two simultaneous logins cannot both think they hold the last slot.
  perform pg_advisory_xact_lock(hashtext('devices:' || p_user_id::text));

  select * into v_device
  from public.devices d
  where d.user_id = p_user_id and d.fingerprint_hash = p_fingerprint_hash;
  v_exists := found;

  if v_exists and v_device.removed_at is null then
    -- same device signing in again: refresh it in place.
    update public.devices set last_seen = now(), name = coalesce(p_name, name), platform = p_platform
    where id = v_device.id;
  elsif v_exists then
    -- a previously retired device coming back; it simply takes a slot again.
    update public.devices
    set removed_at = null, cooldown_until = null, last_seen = now(),
        name = coalesce(p_name, name), platform = p_platform
    where id = v_device.id;
    perform public.fn_audit('user', p_user_id, 'device.registered', v_device.id::text,
      jsonb_build_object('platform', p_platform, 'created', false));
  else
    insert into public.devices (user_id, fingerprint_hash, platform, name)
    values (p_user_id, p_fingerprint_hash, p_platform, p_name)
    returning * into v_device;
    v_created := true;
    perform public.fn_audit('user', p_user_id, 'device.registered', v_device.id::text,
      jsonb_build_object('platform', p_platform, 'created', true));
  end if;

  -- anything over the ceiling loses its slot and its session.
  v_superseded := public.fn_enforce_device_limit(p_user_id, v_device.id);

  v_session := public.fn_start_session(p_user_id, v_device.id);
  return query select v_device.id, v_session, v_created, v_superseded;
end;
$$;

-- Attach a session to the account's newest existing device without registering anything or
-- displacing anyone. Only the service role may call it; admin-api uses it for impersonation so
-- that "open the app as this user" never signs the real user out.
create or replace function public.fn_start_shadow_session(p_user_id uuid)
returns table (device_id uuid, session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device uuid;
  v_session uuid;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  perform public.fn_begin_internal_write();

  select d.id into v_device from public.devices d
  where d.user_id = p_user_id and d.removed_at is null
  order by d.last_seen desc nulls last limit 1;
  if v_device is null then
    raise exception 'user has no active device to shadow' using errcode = 'P0002';
  end if;

  -- deliberately not fn_start_session: no revocation, no current_session_id move.
  insert into public.sessions (user_id, device_id) values (p_user_id, v_device)
  returning id into v_session;

  perform public.fn_audit('service', p_user_id, 'session.impersonated', v_session::text,
    jsonb_build_object('device_id', v_device));
  return query select v_device, v_session;
end;
$$;
revoke execute on function public.fn_start_shadow_session(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- refunds
--
-- Money for iOS/Android purchases sits with Apple and Google, so nothing here moves cash. What it
-- does is make a refund a first-class, auditable decision: recorded when asked, decided with the
-- guarantee conditions visible, applied to entitlements on approval, and closed out with the
-- store's own refund reference once an operator has issued it in App Store Connect / Play Console.
-- When web checkout goes live the same rows can carry a processor refund id instead.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.refund_kind as enum ('full', 'partial', 'guarantee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.refund_status as enum ('open', 'approved', 'denied', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists public.refund_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  kind                public.refund_kind not null,
  status              public.refund_status not null default 'open',
  -- what we agreed to give back, in minor units. null until decided.
  amount_cents        int check (amount_cents is null or amount_cents >= 0),
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- which entitlements the refund covers; revoked when the request is approved.
  products            public.product_kind[] not null default '{}'::public.product_kind[],
  -- where the original money came from, so an operator knows which console to open.
  store               text check (store is null or store in ('app_store', 'play', 'paddle', 'lemonsqueezy', 'coupon', 'manual')),
  reason              text,
  -- guarantee claims: score report url, attempt date, mocks completed at the time, etc.
  evidence            jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  requested_by        uuid references auth.users (id) on delete set null,
  decided_by          uuid references auth.users (id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  -- the store's / processor's own id for the money actually returned.
  external_refund_id  text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists refund_requests_status_idx on public.refund_requests (status, created_at desc);
create index if not exists refund_requests_user_idx on public.refund_requests (user_id, created_at desc);

drop trigger if exists refund_requests_updated_at on public.refund_requests;
create trigger refund_requests_updated_at before update on public.refund_requests
  for each row execute function public.fn_set_updated_at();

alter table public.refund_requests enable row level security;
create policy "refund_requests: owner can read"
  on public.refund_requests for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
-- writes: service role only, through the functions below.

-- Can this account claim the pass guarantee (SPEC §6 / legal/refunds)? Reports the facts rather
-- than a verdict, because the score report is a human judgement and always will be.
create or replace function public.fn_guarantee_eligibility(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_granted   timestamptz;
  v_complete  timestamptz;
  v_mocks     int;
  v_claimed   int;
begin
  perform public.fn_assert_admin();

  select min(e.granted_at) into v_granted from public.entitlements e
  where e.user_id = p_user_id and e.product = 'pass_guarantee' and e.revoked_at is null;
  select min(e.granted_at) into v_complete from public.entitlements e
  where e.user_id = p_user_id and e.product = 'complete' and e.revoked_at is null;

  select count(*)::int into v_mocks from public.study_sessions s
  where s.user_id = p_user_id and s.kind = 'mock' and s.status = 'finished';

  select count(*)::int into v_claimed from public.refund_requests r
  where r.user_id = p_user_id and r.status in ('approved', 'paid');

  return jsonb_build_object(
    'has_guarantee', v_granted is not null,
    'guarantee_granted_at', v_granted,
    'complete_granted_at', v_complete,
    -- the 90-day window in the published terms runs from the guarantee purchase
    'days_since_guarantee', case when v_granted is null then null else floor(extract(epoch from (now() - v_granted)) / 86400)::int end,
    'within_window', v_granted is not null and v_granted > now() - interval '90 days',
    'mocks_completed', v_mocks,
    'meets_mock_requirement', v_mocks >= 5,
    -- "one refund per account"
    'already_refunded', v_claimed > 0
  );
end;
$$;

create or replace function public.fn_admin_refund_create(
  p_user_id      uuid,
  p_kind         public.refund_kind,
  p_products     public.product_kind[] default '{}'::public.product_kind[],
  p_amount_cents int default null,
  p_store        text default null,
  p_reason       text default null,
  p_evidence     jsonb default '{}'::jsonb
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.refund_requests;
begin
  perform public.fn_assert_admin();
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_kind = 'partial' and coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '22023';
  end if;

  insert into public.refund_requests (user_id, kind, products, amount_cents, store, reason, evidence, requested_by)
  values (p_user_id, p_kind, coalesce(p_products, '{}'::public.product_kind[]), p_amount_cents, p_store,
          p_reason, coalesce(p_evidence, '{}'::jsonb), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.fn_admin_refund_create(uuid, public.refund_kind, public.product_kind[], int, text, text, jsonb) from public, anon;

-- Approve or deny. Approving revokes the listed entitlements with reason 'refund' so the KPI and
-- the learner's access agree with the decision; a partial refund that keeps Complete simply lists
-- fewer products (or none at all, for a goodwill payment).
create or replace function public.fn_admin_refund_decide(
  p_id           uuid,
  p_approve      boolean,
  p_note         text default null,
  p_amount_cents int default null
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.refund_requests;
  v_product public.product_kind;
  v_revoked int := 0;
begin
  perform public.fn_assert_admin();
  perform public.fn_begin_internal_write();

  select * into v_row from public.refund_requests where id = p_id for update;
  if not found then
    raise exception 'refund request not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    raise exception 'refund request already decided' using errcode = '22023';
  end if;

  update public.refund_requests
  set status = case when p_approve then 'approved'::public.refund_status else 'denied'::public.refund_status end,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = p_note,
      amount_cents = coalesce(p_amount_cents, amount_cents)
  where id = p_id
  returning * into v_row;

  if p_approve then
    foreach v_product in array v_row.products loop
      update public.entitlements
      set revoked_at = now(), revoke_reason = 'refund'
      where user_id = v_row.user_id and product = v_product and revoked_at is null;
      v_revoked := v_revoked + 1;
    end loop;
    perform public.fn_audit('service', v_row.user_id, 'refund.approved', p_id::text,
      jsonb_build_object('kind', v_row.kind, 'amount_cents', v_row.amount_cents, 'products', v_row.products, 'revoked', v_revoked));
  else
    perform public.fn_audit('service', v_row.user_id, 'refund.denied', p_id::text, jsonb_build_object('note', p_note));
  end if;
  return v_row;
end;
$$;
revoke execute on function public.fn_admin_refund_decide(uuid, boolean, text, int) from public, anon;

-- The money left our side. `p_external_refund_id` is the App Store / Play / processor reference so
-- the row can be reconciled later; it is the only proof the refund really happened.
create or replace function public.fn_admin_refund_mark_paid(p_id uuid, p_external_refund_id text)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.refund_requests;
begin
  perform public.fn_assert_admin();
  if coalesce(btrim(p_external_refund_id), '') = '' then
    raise exception 'a store or processor refund reference is required' using errcode = '22023';
  end if;

  update public.refund_requests
  set status = 'paid', paid_at = now(), external_refund_id = btrim(p_external_refund_id)
  where id = p_id and status = 'approved'
  returning * into v_row;
  if not found then
    raise exception 'refund request is not approved' using errcode = '22023';
  end if;

  perform public.fn_audit('service', v_row.user_id, 'refund.paid', p_id::text,
    jsonb_build_object('external_refund_id', v_row.external_refund_id, 'amount_cents', v_row.amount_cents));
  return v_row;
end;
$$;
revoke execute on function public.fn_admin_refund_mark_paid(uuid, text) from public, anon;

-- List for the console, with the email joined in so it does not need a second round trip.
create or replace function public.fn_admin_refunds(p_status text default null, p_limit int default 100)
returns table (
  id uuid, user_id uuid, email text, kind public.refund_kind, status public.refund_status,
  amount_cents int, currency text, products public.product_kind[], store text, reason text,
  evidence jsonb, decision_note text, external_refund_id text,
  decided_at timestamptz, paid_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_assert_admin();
  return query
    select r.id, r.user_id, u.email::text, r.kind, r.status,
           r.amount_cents, r.currency, r.products, r.store, r.reason,
           r.evidence, r.decision_note, r.external_refund_id,
           r.decided_at, r.paid_at, r.created_at
    from public.refund_requests r
    left join auth.users u on u.id = r.user_id
    where p_status is null or r.status = p_status::public.refund_status
    order by r.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- Totals for the refunds screen. Counted from decisions, not from entitlement side effects.
create or replace function public.fn_admin_refund_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.fn_assert_admin();
  select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'approved', count(*) filter (where status = 'approved'),
    'denied', count(*) filter (where status = 'denied'),
    'paid', count(*) filter (where status = 'paid'),
    'paid_cents', coalesce(sum(amount_cents) filter (where status = 'paid'), 0),
    'awaiting_payout_cents', coalesce(sum(amount_cents) filter (where status = 'approved'), 0)
  ) into v from public.refund_requests;
  return v;
end;
$$;
