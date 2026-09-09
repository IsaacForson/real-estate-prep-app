-- ---------------------------------------------------------------------------
-- 0017: make impersonation actually work.
--
-- 0016 shipped fn_start_shadow_session, but it was broken in two ways that only show up against a
-- real account:
--
--   1. fn_session_is_valid requires profiles.current_session_id = this session whenever the account
--      is limited to one device. A shadow session deliberately does NOT move that pointer (moving
--      it is exactly what would sign the learner out), so every request made while impersonating
--      failed validation. "Open as user" appeared to do nothing.
--
--   2. It refused outright when the target had no device row. Someone who signed up and never
--      opened the app is precisely the account an operator most wants to look at.
--
-- The fix is to make a shadow session a first-class kind of session rather than a normal session
-- that happens to be attached to someone else's device:
--
--   * sessions.is_shadow marks it, and fn_session_is_valid accepts it on its own terms.
--   * sessions.expires_at bounds it. An admin session that lives forever is a standing key to
--     someone's account; 60 minutes is long enough to diagnose a problem and short enough that
--     forgetting to press Stop is not a security incident.
--   * devices.is_shadow lets us mint a device when the user has none, without that device
--     consuming their slot or appearing in their own device list. Otherwise, under the default
--     one-device rule, an admin looking at an account could retire the learner's real phone.
-- ---------------------------------------------------------------------------

alter table public.sessions add column if not exists is_shadow  boolean not null default false;
alter table public.sessions add column if not exists expires_at timestamptz;
alter table public.devices  add column if not exists is_shadow  boolean not null default false;

-- live shadow sessions, for the admin console and for expiry sweeps
create index if not exists sessions_shadow_idx on public.sessions (user_id, created_at desc)
  where is_shadow and revoked_at is null;

-- ---------------------------------------------------------------------------
-- A shadow session is valid on its own terms: not revoked, not expired, and its device still
-- exists. It never needs to be the account's "current" session, which is the whole point.
-- ---------------------------------------------------------------------------
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
      and (
        case
          when s.is_shadow then s.expires_at is null or s.expires_at > now()
          else public.fn_max_active_devices() > 1 or p.current_session_id = s.id
        end
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Shadow devices are invisible to the slot accounting. Without this, minting one for a user with
-- no device would immediately count against their ceiling, and for a user who already has a phone
-- the shadow could rank above it and retire the real one.
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

  with ranked as (
    select d.id, row_number() over (order by d.last_seen desc nulls last, d.first_seen desc) as rn
    from public.devices d
    where d.user_id = p_user_id and d.removed_at is null and d.id <> p_keep
      and not d.is_shadow
  ), doomed as (
    select id from ranked where rn > greatest(0, v_max - 1)
  )
  update public.devices d
  set removed_at = now(), cooldown_until = null
  where d.id in (select id from doomed);
  get diagnostics v_retired = row_count;

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

create or replace function public.fn_active_device_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.devices d
  where d.user_id = p_user_id and d.removed_at is null and not d.is_shadow;
$$;

-- ---------------------------------------------------------------------------
-- A learner signing in must not kill an admin's shadow session (they would be looking at a broken
-- screen with no explanation), and the takeover rule was never about admin sessions anyway.
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

  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id
    and s.revoked_at is null
    and not s.is_shadow
    and (v_max <= 1 or s.device_id = p_device_id);
  get diagnostics v_revoked = row_count;

  insert into public.sessions (user_id, device_id) values (p_user_id, p_device_id)
  returning id into v_session;

  update public.profiles set current_session_id = v_session where id = p_user_id;

  perform public.fn_audit('user', p_user_id, 'session.started', v_session::text,
    jsonb_build_object('device_id', p_device_id, 'revoked_sessions', v_revoked, 'max_active_devices', v_max));
  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attach an admin session to the account without displacing anyone, minting a shadow device when
-- the user has none. Reuses the user's newest real device when there is one, so what the admin
-- sees matches what the learner sees.
-- ---------------------------------------------------------------------------
-- the return type gains minted_device/expires_at, which create-or-replace cannot do
drop function if exists public.fn_start_shadow_session(uuid);
create function public.fn_start_shadow_session(p_user_id uuid)
returns table (device_id uuid, session_id uuid, minted_device boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  uuid;
  v_session uuid;
  v_minted  boolean := false;
  v_expires timestamptz := now() + interval '60 minutes';
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  perform public.fn_begin_internal_write();

  -- prefer a real device so the admin sees the learner's actual state
  select d.id into v_device from public.devices d
  where d.user_id = p_user_id and d.removed_at is null and not d.is_shadow
  order by d.last_seen desc nulls last limit 1;

  -- otherwise reuse this account's existing shadow device, so repeated visits do not pile up rows
  if v_device is null then
    select d.id into v_device from public.devices d
    where d.user_id = p_user_id and d.removed_at is null and d.is_shadow
    order by d.last_seen desc nulls last limit 1;
    if v_device is not null then
      update public.devices set last_seen = now() where id = v_device;
    end if;
  end if;

  if v_device is null then
    -- fingerprint_hash is constrained to 64 hex chars and unique per user; derive it so the same
    -- account always regenerates the same shadow device instead of a new one each time.
    insert into public.devices (user_id, fingerprint_hash, platform, name, is_shadow)
    values (p_user_id, encode(extensions.digest('shadow:' || p_user_id::text, 'sha256'), 'hex'), 'web', 'Admin support session', true)
    returning id into v_device;
    v_minted := true;
    perform public.fn_audit('service', p_user_id, 'device.shadow_created', v_device::text, '{}'::jsonb);
  end if;

  -- one live shadow session per account: a second "open as user" replaces the first
  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id and s.is_shadow and s.revoked_at is null;

  insert into public.sessions (user_id, device_id, is_shadow, expires_at)
  values (p_user_id, v_device, true, v_expires)
  returning id into v_session;

  perform public.fn_audit('service', p_user_id, 'session.impersonated', v_session::text,
    jsonb_build_object('device_id', v_device, 'minted_device', v_minted, 'expires_at', v_expires));
  return query select v_device, v_session, v_minted, v_expires;
end;
$$;
revoke execute on function public.fn_start_shadow_session(uuid) from public, anon, authenticated;

-- Pressing "Stop" should end the session server-side, not just locally in the admin's browser.
create or replace function public.fn_end_shadow_session(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ended int := 0;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  perform public.fn_begin_internal_write();

  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id and s.is_shadow and s.revoked_at is null;
  get diagnostics v_ended = row_count;

  if v_ended > 0 then
    perform public.fn_audit('service', p_user_id, 'session.impersonation_ended', p_user_id::text,
      jsonb_build_object('ended_sessions', v_ended));
  end if;
  return v_ended;
end;
$$;
revoke execute on function public.fn_end_shadow_session(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The learner's own device screen should not show a device they never signed in on. The admin
-- console still sees it (it reads public.devices directly) which is where it belongs.
-- ---------------------------------------------------------------------------
drop view if exists public.v_my_devices;
create view public.v_my_devices
with (security_invoker = true) as
  select d.id, d.platform, d.name, d.first_seen, d.last_seen, d.removed_at,
         (d.removed_at is null) as active,
         exists (select 1 from public.sessions s where s.device_id = d.id and s.revoked_at is null) as has_live_session
  from public.devices d
  where d.user_id = auth.uid() and not d.is_shadow;

grant select on public.v_my_devices to authenticated;
