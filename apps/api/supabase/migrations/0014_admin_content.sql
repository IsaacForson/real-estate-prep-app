-- 0014_admin_content.sql
-- V2_PLAN §1 "admin console" + §2 analytics:
--   admin_audit       — one row per admin-api op (who, what, before / after)
--   content_versions  — what `pipeline publish --remote` shipped; the app polls the latest row daily
--   content_alerts    — `pipeline watch-sources` findings (citation changed, url dead, ...)
--   fn_admin_kpis(range), fn_admin_user(uid), fn_admin_search_users(q, limit, offset)
--                     — security definer; callable by admins (profiles.is_admin) and the service role
--
-- everything privileged goes through the admin-api edge function (service role). the admin rls
-- policies below exist so the console can *read* through postgrest where convenient (fn_is_admin()).

-- ---------------------------------------------------------------------------
-- admin_audit
-- ---------------------------------------------------------------------------
create table public.admin_audit (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references auth.users (id) on delete set null,
  action       text not null,            -- the admin-api op name, e.g. 'entitlements.grant'
  target_type  text,                     -- 'user' | 'entitlement' | 'coupon' | 'ticket' | 'review' | 'device' | 'alert' | ...
  target_id    text,
  before       jsonb,
  after        jsonb,
  ip_hash      text,
  created_at   timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit (created_at desc);
create index admin_audit_target_idx on public.admin_audit (target_type, target_id, created_at desc);

alter table public.admin_audit enable row level security;
create policy "admin_audit: admin can read"
  on public.admin_audit for select to authenticated
  using (public.fn_is_admin());
-- writes: service role only (admin-api).

-- ---------------------------------------------------------------------------
-- content_versions / content_alerts
-- ---------------------------------------------------------------------------
create table public.content_versions (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,     -- e.g. '2026.09.09-1' or the git sha
  published_at  timestamptz not null default now(),
  item_count    int not null default 0 check (item_count >= 0),
  -- per-bank counts + manifest path so the client can refresh only what changed
  banks         jsonb not null default '{}'::jsonb check (jsonb_typeof(banks) = 'object'),
  manifest_path text,                     -- storage path in the `content` bucket (e.g. 'manifest/<version>.json')
  notes         text,
  created_at    timestamptz not null default now()
);
create index content_versions_published_idx on public.content_versions (published_at desc);

alter table public.content_versions enable row level security;
-- the app checks the latest version daily before sign-in completes on a new device: readable by all.
create policy "content_versions: anyone can read"
  on public.content_versions for select to anon, authenticated
  using (true);

create table public.content_alerts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,            -- 'citation_changed' | 'url_unreachable' | 'refs_audit' | 'pvalue' | ...
  jurisdiction  text check (jurisdiction is null or jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  ref           text,                     -- statute section / item id / url
  detail        jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by   uuid references auth.users (id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index content_alerts_status_idx on public.content_alerts (status, created_at desc);

alter table public.content_alerts enable row level security;
create policy "content_alerts: admin can read"
  on public.content_alerts for select to authenticated
  using (public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- admin read policies on tables that only had owner policies
-- ---------------------------------------------------------------------------
create policy "profiles: admin can read"      on public.profiles      for select to authenticated using (public.fn_is_admin());
create policy "entitlements: admin can read"  on public.entitlements  for select to authenticated using (public.fn_is_admin());
create policy "devices: admin can read"       on public.devices       for select to authenticated using (public.fn_is_admin());
create policy "sessions: admin can read"      on public.sessions      for select to authenticated using (public.fn_is_admin());
create policy "study_sessions: admin can read" on public.study_sessions for select to authenticated using (public.fn_is_admin());
create policy "anomaly_flags: admin can read" on public.anomaly_flags for select to authenticated using (public.fn_is_admin());
create policy "audit_log: admin can read"     on public.audit_log     for select to authenticated using (public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.fn_assert_admin()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not (public.fn_is_service_role() or public.fn_is_admin(auth.uid())) then
    raise exception 'admin only' using errcode = '42501';
  end if;
end;
$$;

-- '7d' | '30d' | '90d' | 'all' -> lower bound
create or replace function public.fn_range_start(p_range text)
returns timestamptz
language sql
stable
as $$
  select case p_range
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '90d' then now() - interval '90 days'
    else '-infinity'::timestamptz
  end;
$$;

-- usd amount of a purchase webhook, best effort per provider. null when unknown.
--   revenuecat: event.price (usd, may be null for sandbox) ; paddle: data.details.totals.total (cents) ;
--   lemon squeezy: data.attributes.total_usd (cents)
create or replace function public.fn_webhook_revenue_usd(p_provider text, p_payload jsonb)
returns numeric
language sql
immutable
as $$
  select case p_provider
    when 'revenuecat'   then nullif(p_payload->'event'->>'price', '')::numeric
    when 'paddle'       then nullif(p_payload->'data'->'details'->'totals'->>'total', '')::numeric / 100
    when 'lemonsqueezy' then nullif(p_payload->'data'->'attributes'->>'total_usd', '')::numeric / 100
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- fn_admin_kpis(range) -> jsonb (shape in V2_PLAN §6.2 "kpis")
-- ---------------------------------------------------------------------------
create or replace function public.fn_admin_kpis(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since      timestamptz := public.fn_range_start(p_range);
  v_series_from date := (case when p_range = 'all' then now() - interval '90 days' else v_since end)::date;
  v_signups    int;
  v_dau        int;
  v_wau        int;
  v_mau        int;
  v_purchases  jsonb;
  v_refunds    int;
  v_complete   int;
  v_guarantee  int;
  v_conv       numeric;
  v_mocks      int;
  v_answers    int;
  v_tickets    int;
  v_reviews    int;
  v_series     jsonb;
begin
  perform public.fn_assert_admin();

  select count(*)::int into v_signups from auth.users u where u.created_at >= v_since;
  select count(distinct e.user_id)::int into v_dau from public.events e where e.user_id is not null and e.created_at > now() - interval '1 day';
  select count(distinct e.user_id)::int into v_wau from public.events e where e.user_id is not null and e.created_at > now() - interval '7 days';
  select count(distinct e.user_id)::int into v_mau from public.events e where e.user_id is not null and e.created_at > now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object('store', s.store, 'count', s.cnt, 'revenue_usd', s.rev) order by s.store), '[]'::jsonb)
  into v_purchases
  from (
    select e.source::text as store,
           count(*) filter (where e.product = 'complete') as cnt,
           coalesce((
             select round(sum(public.fn_webhook_revenue_usd(w.provider, w.payload)), 2)
             from public.webhook_events w
             where w.received_at >= v_since and w.result like 'granted%'
               and w.provider = case when e.source::text like 'revenuecat%' then 'revenuecat' else e.source::text end
           ), 0) as rev
    from public.entitlements e
    where e.granted_at >= v_since and e.source not in ('manual', 'coupon')
    group by e.source
  ) s;

  select count(*)::int into v_refunds from public.entitlements e
  where e.revoked_at >= v_since and e.revoke_reason in ('refund', 'chargeback');

  select count(distinct e.user_id)::int into v_complete from public.entitlements e
  where e.product = 'complete' and e.revoked_at is null and (e.paused_until is null or e.paused_until <= now());
  select count(distinct e.user_id)::int into v_guarantee from public.entitlements e
  where e.product = 'pass_guarantee' and e.revoked_at is null and (e.paused_until is null or e.paused_until <= now());

  -- cohort conversion: of the accounts created in range, how many hold a live `complete`.
  select case when count(*) = 0 then 0
              else round(100.0 * count(*) filter (where public.fn_has_entitlement(u.id, 'complete')) / count(*), 2) end
  into v_conv
  from auth.users u where u.created_at >= v_since;

  select count(*)::int into v_mocks from public.study_sessions s
  where s.kind = 'mock' and s.status = 'finished' and s.finished_at >= v_since;
  select count(*)::int into v_answers from public.answers a where a.answered_at >= v_since;
  select count(*)::int into v_tickets from public.support_tickets t where t.status = 'open';
  select count(*)::int into v_reviews from public.reviews r where r.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'signups',   (select count(*) from auth.users u where u.created_at::date = d.day),
           'purchases', (select count(*) from public.entitlements e where e.product = 'complete' and e.source not in ('manual','coupon') and e.granted_at::date = d.day),
           'answers',   (select count(*) from public.answers a where a.answered_at::date = d.day)
         ) order by d.day), '[]'::jsonb)
  into v_series
  from generate_series(v_series_from, now()::date, interval '1 day') as d(day);

  return jsonb_build_object(
    'range', p_range,
    'signups', v_signups,
    'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
    'purchases', v_purchases,
    'refunds', v_refunds,
    'active_complete', v_complete,
    'active_guarantee', v_guarantee,
    'conversion_pct', v_conv,
    'mocks_completed', v_mocks,
    'answers', v_answers,
    'tickets_open', v_tickets,
    'reviews_pending', v_reviews,
    'series', v_series
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_admin_user(uid) -> jsonb (everything the console shows on one user; auth fields come from the
-- edge function via auth.admin.getUserById so this stays schema-agnostic about auth.users)
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
    'devices', coalesce((select jsonb_agg(to_jsonb(d) order by d.last_seen desc) from public.devices d where d.user_id = p_user_id), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- fn_admin_search_users(q, limit, offset): auth.users is not reachable through postgrest.
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
           (select count(*)::int from public.devices d where d.user_id = h.id and d.removed_at is null),
           count(*) over () as total
    from hits h
    left join public.profiles p on p.id = h.id
    order by h.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- admin pause / resume without revoking (V2_PLAN §6.2 entitlements.pause/resume)
create or replace function public.fn_pause_entitlement(p_user_id uuid, p_product public.product_kind, p_until timestamptz)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  update public.entitlements
  set paused_until = p_until
  where user_id = p_user_id and product = p_product and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.fn_pause_entitlement(uuid, public.product_kind, timestamptz) from public, anon, authenticated;

-- support-side revoke by user + product (no provider object), for admin-api entitlements.revoke.
create or replace function public.fn_revoke_entitlement_by_user(p_user_id uuid, p_product public.product_kind, p_reason text default 'support')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  update public.entitlements
  set revoked_at = now(), revoke_reason = p_reason
  where user_id = p_user_id and product = p_product and revoked_at is null;
  get diagnostics v_count = row_count;
  perform public.fn_audit('service', p_user_id, 'entitlement.revoked', null,
    jsonb_build_object('product', p_product, 'reason', p_reason, 'count', v_count));
  return v_count;
end;
$$;
revoke execute on function public.fn_revoke_entitlement_by_user(uuid, public.product_kind, text) from public, anon, authenticated;

-- emails for a set of user ids (tickets / reviews lists in the console). admin or service only.
create or replace function public.fn_admin_emails(p_ids uuid[])
returns table (id uuid, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_assert_admin();
  return query select u.id, u.email::text from auth.users u where u.id = any (p_ids);
end;
$$;

-- devices shared by >= 3 accounts, blocked, or free-tier-exhausted (admin-api devices.flagged).
create or replace function public.fn_admin_flagged_devices(p_limit int default 200)
returns setof public.device_fingerprints
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_assert_admin();
  return query
    select d.* from public.device_fingerprints d
    where d.blocked or d.free_tier_exhausted_at is not null or cardinality(d.account_ids) >= 3
    order by d.last_seen desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
