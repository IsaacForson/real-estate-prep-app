-- 0022_two_devices_evict_oldest.sql
-- Two active devices per account by default; a third sign-in evicts the OLDEST device, never the
-- one signing in; the same device signing in again reuses its row AND its session.
--
-- What was wrong (live data, 2026-09-09): every web sign-in produced two register-device calls a
-- few hundred ms apart (two tabs / the auth broadcast), both on the same device row. fn_start_session
-- revoked "this device's previous session" on every call, so whichever caller kept the first session
-- id was holding a revoked one, got 401 session_revoked on its next request, signed the browser out
-- locally — and supabase-js broadcasts that sign-out to every tab. The newest login was the one that
-- kept getting logged out, and a plain reload looked like a sign-out. The fingerprint itself was
-- stable the whole time.
--
-- Rules from here on:
--   * app_settings.device_policy.max_active_devices defaults to 2 (still admin-adjustable, 1..10).
--   * fn_start_session reuses a live session for the same device instead of minting a new one.
--   * fn_evict_over_limit retires only what exceeds the ceiling, oldest last_seen first (tie: oldest
--     first_seen), records WHICH device did it (sessions.revoked_by_device_id, reason 'new_device')
--     so the evicted device can be told "your account signed in on <name> at <time>".
--   * fn_session_is_valid no longer needs profiles.current_session_id: a stored session is good for
--     as long as it is not revoked and its device is still active.
--   * fn_register_device gains p_adopt_device_id: a client whose stored fingerprint changed can keep
--     its device row by moving the fingerprint onto it instead of registering a new device.
--   * Same device again never evicts anything, even after an admin lowered the ceiling.

-- ---------------------------------------------------------------------------
-- 1. default ceiling: 2. Only the shipped default (1) is moved; an operator's explicit value stands.
-- ---------------------------------------------------------------------------
update public.app_settings
set value = jsonb_set(value, '{max_active_devices}', '2'::jsonb), updated_at = now()
where key = 'device_policy'
  and coalesce((value ->> 'max_active_devices')::int, 1) = 1;

insert into public.app_settings (key, value) values ('device_policy', '{"max_active_devices": 2}'::jsonb)
on conflict (key) do nothing;

create or replace function public.fn_max_active_devices()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(10,
    coalesce((public.fn_app_setting('device_policy', '{"max_active_devices": 2}'::jsonb) ->> 'max_active_devices')::int, 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- 2. who evicted whom
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists revoked_by_device_id uuid references public.devices (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. validity: not revoked, device still active, shadow sessions not expired. No "current" pointer.
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
    join public.devices d on d.id = s.device_id
    where s.id = p_session_id
      and s.user_id = p_user_id
      and s.device_id = p_device_id
      and s.revoked_at is null
      and d.removed_at is null
      and (not s.is_shadow or s.expires_at is null or s.expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. eviction: everything except p_keep, most recent first; anything past (max - 1) goes.
--    Returns the evicted device ids so the caller can name them and emit events.
-- ---------------------------------------------------------------------------
create or replace function public.fn_evict_over_limit(p_user_id uuid, p_keep uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max     int := public.fn_max_active_devices();
  v_evicted uuid[] := '{}';
  v_now     timestamptz := now();
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  with ranked as (
    select d.id,
           row_number() over (order by d.last_seen desc nulls last, d.first_seen desc, d.id desc) as rn
    from public.devices d
    where d.user_id = p_user_id and d.removed_at is null and d.id <> p_keep and not d.is_shadow
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_evicted
  from ranked where rn > greatest(0, v_max - 1);

  if cardinality(v_evicted) = 0 then
    return v_evicted;
  end if;

  update public.devices d
  set removed_at = v_now, cooldown_until = null
  where d.id = any (v_evicted);

  update public.sessions s
  set revoked_at = v_now, revoke_reason = 'new_device', revoked_by_device_id = p_keep
  where s.user_id = p_user_id
    and s.revoked_at is null
    and s.device_id = any (v_evicted);

  perform public.fn_audit('user', p_user_id, 'device.evicted', p_keep::text,
    jsonb_build_object('evicted_devices', to_jsonb(v_evicted), 'max_active_devices', v_max));
  return v_evicted;
end;
$$;

-- kept for callers that want a count (0016 fn_retire_other_devices, smoke script)
create or replace function public.fn_enforce_device_limit(p_user_id uuid, p_keep uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce(cardinality(public.fn_evict_over_limit(p_user_id, p_keep)), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. start (or resume) a session for a device. One live session per device: if there is one, it is
--    returned; older duplicates on the same device are folded into it.
-- ---------------------------------------------------------------------------
create or replace function public.fn_start_session(p_user_id uuid, p_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_folded  int := 0;
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  if not exists (select 1 from public.devices d where d.id = p_device_id and d.user_id = p_user_id and d.removed_at is null) then
    raise exception 'device not registered' using errcode = 'P0002';
  end if;

  select s.id into v_session
  from public.sessions s
  where s.user_id = p_user_id and s.device_id = p_device_id and s.revoked_at is null and not s.is_shadow
  order by s.started_at desc
  limit 1;

  if v_session is not null then
    update public.sessions set last_seen_at = now() where id = v_session;
    update public.sessions s
    set revoked_at = now(), revoke_reason = 'superseded'
    where s.user_id = p_user_id and s.device_id = p_device_id and s.revoked_at is null
      and not s.is_shadow and s.id <> v_session;
    get diagnostics v_folded = row_count;
    update public.profiles set current_session_id = v_session where id = p_user_id;
    perform public.fn_audit('user', p_user_id, 'session.resumed', v_session::text,
      jsonb_build_object('device_id', p_device_id, 'folded_sessions', v_folded));
    return v_session;
  end if;

  insert into public.sessions (user_id, device_id) values (p_user_id, p_device_id)
  returning id into v_session;

  -- records the most recent sign-in; nothing requires it any more
  update public.profiles set current_session_id = v_session where id = p_user_id;

  perform public.fn_audit('user', p_user_id, 'session.started', v_session::text,
    jsonb_build_object('device_id', p_device_id, 'max_active_devices', public.fn_max_active_devices()));
  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. register (or re-activate, or adopt) a device and start / resume its session.
--    returns device_id, session_id, created, superseded (count), evicted (ids), session_reused, adopted.
--    The return type changes, so the 0016 version has to be dropped first.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_register_device(uuid, text, public.device_platform, text);
create function public.fn_register_device(
  p_user_id          uuid,
  p_fingerprint_hash text,
  p_platform         public.device_platform,
  p_name             text default null,
  p_adopt_device_id  uuid default null
)
returns table (
  device_id      uuid,
  session_id     uuid,
  created        boolean,
  superseded     int,
  evicted        uuid[],
  session_reused boolean,
  adopted        boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device      public.devices%rowtype;
  v_adopt       public.devices%rowtype;
  v_exists      boolean;
  v_was_active  boolean := false;
  v_created     boolean := false;
  v_adopted     boolean := false;
  v_session     uuid;
  v_existing    uuid;
  v_evicted     uuid[] := '{}';
begin
  perform public.fn_assert_owner(p_user_id);
  perform public.fn_begin_internal_write();

  -- serialise per user: two simultaneous sign-ins (two tabs) must see each other's rows.
  perform pg_advisory_xact_lock(hashtext('devices:' || p_user_id::text));

  -- adopt: the client still holds a device id from before its fingerprint changed. Keep the row,
  -- move the fingerprint onto it — unless the new fingerprint already names another row for this
  -- account, in which case that row IS this device now and the stale one is folded away so a
  -- single physical device never holds two slots.
  if p_adopt_device_id is not null then
    select * into v_adopt
    from public.devices d
    where d.id = p_adopt_device_id and d.user_id = p_user_id and d.removed_at is null and not d.is_shadow;
    if found and v_adopt.fingerprint_hash <> p_fingerprint_hash then
      if exists (select 1 from public.devices d where d.user_id = p_user_id and d.fingerprint_hash = p_fingerprint_hash) then
        update public.devices set removed_at = now(), cooldown_until = null where id = v_adopt.id;
        update public.sessions s
        set revoked_at = now(), revoke_reason = 'superseded'
        where s.device_id = v_adopt.id and s.revoked_at is null;
        perform public.fn_audit('user', p_user_id, 'device.folded', v_adopt.id::text,
          jsonb_build_object('into_fingerprint', left(p_fingerprint_hash, 12)));
      else
        update public.devices
        set fingerprint_hash = p_fingerprint_hash, platform = p_platform, last_seen = now()
        where id = v_adopt.id;
        v_adopted := true;
        perform public.fn_audit('user', p_user_id, 'device.fingerprint_adopted', v_adopt.id::text,
          jsonb_build_object('platform', p_platform));
      end if;
    end if;
  end if;

  select * into v_device
  from public.devices d
  where d.user_id = p_user_id and d.fingerprint_hash = p_fingerprint_hash;
  v_exists := found;

  if v_exists and v_device.removed_at is null then
    -- same device signing in again: refresh it in place. Nothing else moves.
    v_was_active := true;
    update public.devices set last_seen = now(), name = coalesce(p_name, name), platform = p_platform
    where id = v_device.id;
  elsif v_exists then
    -- a previously retired / evicted device coming back; it takes a slot again.
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

  -- only a device that was not already holding a slot can push somebody out.
  if not v_was_active then
    v_evicted := public.fn_evict_over_limit(p_user_id, v_device.id);
  end if;

  select s.id into v_existing
  from public.sessions s
  where s.user_id = p_user_id and s.device_id = v_device.id and s.revoked_at is null and not s.is_shadow
  order by s.started_at desc
  limit 1;

  v_session := public.fn_start_session(p_user_id, v_device.id);

  return query
    select v_device.id, v_session, v_created, coalesce(cardinality(v_evicted), 0), v_evicted,
           (v_existing is not null and v_existing = v_session), v_adopted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. admin console: the device list gains the session facts the page already tries to show
--    (has_live_session) plus who evicted a device and when. Body otherwise identical to 0018.
-- ---------------------------------------------------------------------------
create or replace function public.fn_admin_user(p_user_id uuid)
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
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
    'entitlements', coalesce((select jsonb_agg(to_jsonb(e) order by e.granted_at desc) from public.entitlements e where e.user_id = p_user_id), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(
        to_jsonb(d) || jsonb_build_object(
          'has_live_session', exists (select 1 from public.sessions s where s.device_id = d.id and s.revoked_at is null),
          'last_revoke_reason', (select s.revoke_reason from public.sessions s where s.device_id = d.id order by s.started_at desc limit 1),
          'evicted_by', (
            select jsonb_build_object('device_id', x.id, 'name', x.name, 'platform', x.platform, 'at', s.revoked_at)
            from public.sessions s join public.devices x on x.id = s.revoked_by_device_id
            where s.device_id = d.id and s.revoke_reason = 'new_device'
            order by s.revoked_at desc limit 1)
        ) order by d.last_seen desc)
      from public.devices d where d.user_id = p_user_id), '[]'::jsonb),
    'max_active_devices', public.fn_max_active_devices(),
    'active_devices', public.fn_active_device_count(p_user_id),
    'shadow_sessions', (select count(*)::int from public.sessions s
                        where s.user_id = p_user_id and s.is_shadow and s.revoked_at is null
                          and (s.expires_at is null or s.expires_at > now())),
    'device_fingerprints', coalesce((
      select jsonb_agg(jsonb_build_object('device_hash', f.device_hash, 'platform', f.platform, 'model', f.model,
               'accounts', cardinality(f.account_ids), 'blocked', f.blocked, 'exhausted', f.free_tier_exhausted_at is not null,
               'first_seen', f.first_seen, 'last_seen', f.last_seen))
      from public.device_fingerprints f where p_user_id = any (f.account_ids)), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'jurisdiction', s.jurisdiction, 'bank', s.bank,
               'form_id', s.form_id, 'status', s.status, 'started_at', s.started_at, 'finished_at', s.finished_at,
               'position', s.position, 'items', cardinality(s.item_ids), 'score', s.score, 'device_hash', s.device_hash)
               order by s.started_at desc)
      from (select * from public.study_sessions x where x.user_id = p_user_id order by x.started_at desc limit 50) s), '[]'::jsonb),
    'free_tier', coalesce((
      select jsonb_object_agg(u.jurisdiction, jsonb_build_object('questions_used', u.questions_used, 'mocks_used', u.mocks_used))
      from public.free_tier_usage u where u.scope = 'user' and u.scope_id = p_user_id::text), '{}'::jsonb),
    'study', (
      select jsonb_build_object(
        'answers', count(*),
        'accuracy', round(avg(case when a.correct then 1 else 0 end)::numeric, 4),
        'mocks', (select count(*) from public.study_sessions s where s.user_id = p_user_id and s.kind = 'mock' and s.status = 'finished'),
        'items_seen', (select count(*) from public.progress p where p.user_id = p_user_id),
        'items_green', (select count(*) from public.progress p where p.user_id = p_user_id and p.box = 'green'),
        'leeches', (select count(*) from public.progress p where p.user_id = p_user_id and p.leech),
        'last_answered_at', max(a.answered_at))
      from public.answers a where a.user_id = p_user_id),
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (select * from public.events x where x.user_id = p_user_id order by x.created_at desc limit 200) e), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.support_tickets t where t.user_id = p_user_id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r)) from public.reviews r where r.user_id = p_user_id), '[]'::jsonb),
    'coupons', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value, 'product', c.product, 'redeemed_at', r.redeemed_at))
      from public.coupon_redemptions r join public.coupons c on c.code = r.code where r.user_id = p_user_id), '[]'::jsonb),
    'anomaly_flags', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.anomaly_flags f where f.user_id = p_user_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
