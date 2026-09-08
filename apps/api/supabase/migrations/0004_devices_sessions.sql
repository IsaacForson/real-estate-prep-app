-- 0004_devices_sessions.sql
-- SPEC §5.3 entitlement mechanics:
--   * device registry: max 3 active devices per account
--   * self-service removal with a 7-day cooldown per slot
--   * single active session token: a new login invalidates the previous session
--
-- these numbers are also mirrored in supabase/functions/_shared/limits.ts for the pure
-- typescript implementation that the edge functions unit-test. keep both in sync.

create table public.devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- sha256 of a stable client fingerprint (install id + platform + model). never raw identifiers.
  fingerprint_hash  text not null check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  platform          public.device_platform not null,
  name              text check (char_length(name) <= 80),
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  removed_at        timestamptz,
  -- while now() < cooldown_until the slot this device occupied is still counted as used.
  cooldown_until    timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, fingerprint_hash)
);
create index devices_user_active_idx on public.devices (user_id) where removed_at is null;

alter table public.devices enable row level security;

create policy "devices: owner can read"
  on public.devices for select to authenticated
  using (user_id = auth.uid());

-- owners may rename a device directly. everything else (register / remove / last_seen) goes
-- through the functions below so the 3-device rule is enforced atomically.
create policy "devices: owner can rename"
  on public.devices for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.fn_devices_protect_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.fn_is_internal_write() then
    new.user_id          := old.user_id;
    new.fingerprint_hash := old.fingerprint_hash;
    new.platform         := old.platform;
    new.first_seen       := old.first_seen;
    new.last_seen        := old.last_seen;
    new.removed_at       := old.removed_at;
    new.cooldown_until   := old.cooldown_until;
    new.created_at       := old.created_at;
  end if;
  return new;
end;
$$;
create trigger devices_protect_columns
  before update on public.devices
  for each row execute function public.fn_devices_protect_columns();

-- ---------------------------------------------------------------------------
-- sessions: our application-level session, one live row per account. this is separate from
-- the supabase auth jwt/refresh token (which stays long-lived, F13: never interrupt a study
-- session to authenticate). a superseded session gets revoked_at set and the client receives
-- 401 session_revoked with a clear "signed in on another device" message.
-- ---------------------------------------------------------------------------
create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  device_id      uuid not null references public.devices (id) on delete cascade,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_reason  text,   -- 'superseded' | 'device_removed' | 'user_signout' | 'reverification'
  created_at     timestamptz not null default now()
);
create index sessions_user_live_idx on public.sessions (user_id) where revoked_at is null;

alter table public.sessions enable row level security;

create policy "sessions: owner can read"
  on public.sessions for select to authenticated
  using (user_id = auth.uid());

alter table public.profiles
  add constraint profiles_current_session_fk
  foreign key (current_session_id) references public.sessions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- devices currently counted against the limit: active ones plus removed ones still in cooldown.
create or replace function public.fn_active_device_count(p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.devices d
  where d.user_id = p_user_id
    and (d.removed_at is null or (d.cooldown_until is not null and d.cooldown_until > now()));
$$;

-- can this fingerprint be (re)registered right now? an already-active fingerprint is always ok
-- (it is the same device logging in again). otherwise a free slot is needed.
create or replace function public.fn_can_register_device(p_user_id uuid, p_fingerprint_hash text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
      select 1 from public.devices d
      where d.user_id = p_user_id and d.fingerprint_hash = p_fingerprint_hash and d.removed_at is null
    )
    or public.fn_active_device_count(p_user_id) < 3;   -- SPEC §5.3: 3 concurrently active devices
$$;

-- start a new session for a device and revoke every other live session (SPEC §5.3 single
-- active session). returns the new session id.
create or replace function public.fn_start_session(p_user_id uuid, p_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_revoked int;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  if not exists (select 1 from public.devices d where d.id = p_device_id and d.user_id = p_user_id and d.removed_at is null) then
    raise exception 'device not registered' using errcode = 'P0002';
  end if;

  update public.sessions s
  set revoked_at = now(), revoke_reason = 'superseded'
  where s.user_id = p_user_id and s.revoked_at is null;
  get diagnostics v_revoked = row_count;

  insert into public.sessions (user_id, device_id) values (p_user_id, p_device_id)
  returning id into v_session;

  update public.profiles set current_session_id = v_session where id = p_user_id;

  perform public.fn_audit('user', p_user_id, 'session.started', v_session::text,
    jsonb_build_object('device_id', p_device_id, 'revoked_sessions', v_revoked));
  return v_session;
end;
$$;

-- is (session, device) the account's single live session? edge functions call this on every
-- authenticated request and answer 401 session_revoked when false.
create or replace function public.fn_session_is_valid(p_user_id uuid, p_session_id uuid, p_device_id uuid)
returns boolean
language sql
stable
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
      and p.current_session_id = s.id
      and d.removed_at is null
  );
$$;

-- bump last_seen on session and device. cheap; called from the edge functions after auth.
create or replace function public.fn_touch_session(p_user_id uuid, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();
  update public.sessions set last_seen_at = now() where id = p_session_id and user_id = p_user_id;
  update public.devices d set last_seen = now()
  from public.sessions s
  where s.id = p_session_id and s.user_id = p_user_id and d.id = s.device_id;
end;
$$;

-- register (or re-activate) a device and start a session. enforces the 3-device rule.
-- returns one row: device_id, session_id, created (true if a new device row was made).
-- raises 'device_limit' (errcode P0003) when all slots are used or cooling down.
create or replace function public.fn_register_device(
  p_user_id          uuid,
  p_fingerprint_hash text,
  p_platform         public.device_platform,
  p_name             text default null
)
returns table (device_id uuid, session_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  public.devices%rowtype;
  v_exists  boolean;
  v_created boolean := false;
  v_session uuid;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  -- serialise per user so two concurrent logins cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('devices:' || p_user_id::text));

  select * into v_device
  from public.devices d
  where d.user_id = p_user_id and d.fingerprint_hash = p_fingerprint_hash;
  v_exists := found;

  if v_exists and v_device.removed_at is null then
    -- same device again: refresh and continue.
    update public.devices set last_seen = now(), name = coalesce(p_name, name), platform = p_platform
    where id = v_device.id;
  else
    if not public.fn_can_register_device(p_user_id, p_fingerprint_hash) then
      raise exception 'device_limit' using errcode = 'P0003',
        detail = 'max 3 active devices; removed devices hold their slot for 7 days';
    end if;
    if v_exists then
      -- previously removed device coming back after its slot freed up.
      update public.devices
      set removed_at = null, cooldown_until = null, last_seen = now(),
          name = coalesce(p_name, name), platform = p_platform
      where id = v_device.id;
    else
      insert into public.devices (user_id, fingerprint_hash, platform, name)
      values (p_user_id, p_fingerprint_hash, p_platform, p_name)
      returning * into v_device;
      v_created := true;
    end if;
    perform public.fn_audit('user', p_user_id, 'device.registered', v_device.id::text,
      jsonb_build_object('platform', p_platform, 'created', v_created));
  end if;

  v_session := public.fn_start_session(p_user_id, v_device.id);
  return query select v_device.id, v_session, v_created;
end;
$$;

-- self-service removal. the slot stays occupied for 7 days (cooldown) and every session on
-- that device is revoked. returns cooldown_until.
create or replace function public.fn_remove_device(p_user_id uuid, p_device_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz := now() + interval '7 days';   -- SPEC §5.3: 7-day cooldown per slot
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  update public.devices
  set removed_at = now(), cooldown_until = v_until
  where id = p_device_id and user_id = p_user_id and removed_at is null;
  if not found then
    raise exception 'device not found or already removed' using errcode = 'P0002';
  end if;

  update public.sessions
  set revoked_at = now(), revoke_reason = 'device_removed'
  where device_id = p_device_id and user_id = p_user_id and revoked_at is null;

  update public.profiles p set current_session_id = null
  where p.id = p_user_id
    and not exists (select 1 from public.sessions s where s.id = p.current_session_id and s.revoked_at is null);

  perform public.fn_audit('user', p_user_id, 'device.removed', p_device_id::text,
    jsonb_build_object('cooldown_until', v_until));
  return v_until;
end;
$$;

-- convenience view for the "your devices" screen.
create or replace view public.v_my_devices
with (security_invoker = true) as
  select d.id, d.platform, d.name, d.first_seen, d.last_seen, d.removed_at, d.cooldown_until,
         (d.removed_at is null) as active,
         (d.removed_at is not null and d.cooldown_until > now()) as cooling_down,
         exists (select 1 from public.sessions s where s.device_id = d.id and s.revoked_at is null) as has_live_session
  from public.devices d
  where d.user_id = auth.uid();
