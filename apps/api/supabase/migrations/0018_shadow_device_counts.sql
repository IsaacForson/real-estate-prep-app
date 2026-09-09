-- ---------------------------------------------------------------------------
-- 0018: keep shadow devices out of the admin console's device counts.
--
-- 0017 hid the shadow device from the learner's own device screen and from the slot accounting,
-- but the console counts devices with its own query. The result was that opening the app as a user
-- who had never signed in made them look like they had a device: "devices: 1" on an account with
-- nothing on it. That is worse than cosmetic, because the device count is what an operator reads
-- to answer "why can't this person sign in".
--
-- The console still needs to see the shadow device (it is part of the impersonation trail), so the
-- detail payload keeps returning every device row and gains two explicit numbers next to it.
-- ---------------------------------------------------------------------------

create or replace function public.fn_admin_search_users(p_q text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz,
  is_admin boolean, home_jurisdiction text, entitlements text[], devices int, total bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public.fn_assert_admin();
  return query
    with hits as (
      select u.id, u.email::text as email, u.created_at, u.last_sign_in_at, u.banned_until
      from auth.users u
      where v_q is null
         or u.email ilike '%' || v_q || '%'
         or (v_q ~ '^[0-9a-f-]{8,36}$' and u.id::text like v_q || '%')
    )
    select h.id, h.email, h.created_at, h.last_sign_in_at, h.banned_until,
           coalesce(p.is_admin, false), p.home_jurisdiction::text,
           coalesce((select array_agg(e.product::text order by e.product) from public.entitlements e
                     where e.user_id = h.id and e.revoked_at is null), '{}'::text[]),
           -- real devices only: a shadow device is ours, not theirs
           (select count(*)::int from public.devices d
            where d.user_id = h.id and d.removed_at is null and not d.is_shadow),
           count(*) over () as total
    from hits h
    left join public.profiles p on p.id = h.id
    order by h.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Same body as 0014 plus `active_devices` (real, slot-holding) and `shadow_sessions` (live
-- impersonations right now), so the detail page can say "no devices" and still show the shadow row.
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
    'devices', coalesce((select jsonb_agg(to_jsonb(d) order by d.last_seen desc) from public.devices d where d.user_id = p_user_id), '[]'::jsonb),
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
