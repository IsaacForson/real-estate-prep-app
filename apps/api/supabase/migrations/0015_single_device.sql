-- 0015_single_device.sql
-- Replaces the SPEC §5.3 "3 slots + 7-day cooldown" device registry with a single active device
-- that the newest sign-in always takes over.
--
-- why: the old rule produced a dead end. A learner signed in on their laptop, went out, opened the
-- phone and got 409 device_limit ("remove a device to sign in here") — and removing one froze that
-- slot for 7 days, so the phone stayed locked out for a week. Sharing was already contained by the
-- single live session (fn_start_session revokes every other session), so the slot ceiling was
-- buying almost nothing while breaking the ordinary one-person-two-gadgets case.
--
-- new rule: one active device. Registering a different fingerprint retires the previous device and
-- starts a fresh session; the old device gets 401 session_revoked on its next call and signs out
-- locally. No refusal path, no cooldown — a retired device can take the slot straight back.
--
-- superseded by 0016, which moves the ceiling into app_settings.device_policy so an admin can
-- change it from the console. The typescript mirror now reads it via _shared/settings.ts.

-- cooldown_until is retained on the table so historical rows stay readable, but nothing sets it
-- from here on. Clear the ones already in flight so no account starts out locked.
update public.devices set cooldown_until = null where cooldown_until is not null;

-- ---------------------------------------------------------------------------
-- slot accounting: active devices only. A removed device frees its slot immediately.
-- ---------------------------------------------------------------------------
create or replace function public.fn_active_device_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.devices d
  where d.user_id = p_user_id and d.removed_at is null;
$$;

-- Kept for callers and tests that still ask. Registration can no longer be refused: an unknown
-- fingerprint takes the slot over, so this is now always true.
create or replace function public.fn_can_register_device(p_user_id uuid, p_fingerprint_hash text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select true;
$$;

-- ---------------------------------------------------------------------------
-- retire every active device for this account except p_keep, revoking their sessions.
-- ---------------------------------------------------------------------------
create or replace function public.fn_retire_other_devices(p_user_id uuid, p_keep uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retired int;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id
    and s.revoked_at is null
    and s.device_id <> p_keep;

  update public.devices d
  set removed_at = now(), cooldown_until = null
  where d.user_id = p_user_id and d.removed_at is null and d.id <> p_keep;
  get diagnostics v_retired = row_count;

  if v_retired > 0 then
    perform public.fn_audit('user', p_user_id, 'device.superseded', p_keep::text,
      jsonb_build_object('retired_devices', v_retired));
  end if;
  return v_retired;
end;
$$;

-- ---------------------------------------------------------------------------
-- register (or re-activate) a device, take over the single slot, start a session.
-- returns device_id, session_id, created, and how many devices were signed out.
-- no longer raises device_limit (P0003).
--
-- the `superseded` column is new, and a returns-table signature cannot be widened by
-- create-or-replace, so the 0004 version has to go first. It carries no explicit grants (default
-- execute only, with fn_assert_owner doing the real check), so nothing needs re-granting.
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

  -- serialise per user so two simultaneous logins cannot both think they hold the slot.
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
    -- a previously retired device coming back; it simply takes the slot again.
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

  -- everything else loses the slot and its session.
  v_superseded := public.fn_retire_other_devices(p_user_id, v_device.id);

  v_session := public.fn_start_session(p_user_id, v_device.id);
  return query select v_device.id, v_session, v_created, v_superseded;
end;
$$;

-- ---------------------------------------------------------------------------
-- self-service / admin removal. The slot frees immediately now, so this is purely
-- "sign that device out". Returns the removal timestamp.
-- ---------------------------------------------------------------------------
create or replace function public.fn_remove_device(p_user_id uuid, p_device_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  update public.devices
  set removed_at = v_now, cooldown_until = null
  where id = p_device_id and user_id = p_user_id and removed_at is null;
  if not found then
    raise exception 'device not found or already removed' using errcode = 'P0002';
  end if;

  update public.sessions
  set revoked_at = v_now, revoke_reason = 'device_removed'
  where device_id = p_device_id and user_id = p_user_id and revoked_at is null;

  update public.profiles p set current_session_id = null
  where p.id = p_user_id
    and not exists (select 1 from public.sessions s where s.id = p.current_session_id and s.revoked_at is null);

  perform public.fn_audit('user', p_user_id, 'device.removed', p_device_id::text, '{}'::jsonb);
  return v_now;
end;
$$;

-- ---------------------------------------------------------------------------
-- "your devices" view: no cooldown concept left to report.
-- ---------------------------------------------------------------------------
drop view if exists public.v_my_devices;
create view public.v_my_devices
with (security_invoker = true) as
  select d.id, d.platform, d.name, d.first_seen, d.last_seen, d.removed_at,
         (d.removed_at is null) as active,
         exists (select 1 from public.sessions s where s.device_id = d.id and s.revoked_at is null) as has_live_session
  from public.devices d
  where d.user_id = auth.uid();

grant select on public.v_my_devices to authenticated;
