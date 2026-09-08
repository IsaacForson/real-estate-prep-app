-- 0005_item_delivery.sql
-- SPEC §5.4 protecting the bank:
--   * never ship the whole bank: the server issues signed batches of 50-200 items with a short ttl
--   * rotate item ids per user (item_id_aliases) so scraped sets cannot be merged across accounts
--   * rate-limit delivery to a plausible human ceiling per hour
--   * canary items: a few uniquely-worded variants per account identify the source of a leak
--
-- there is deliberately NO item text in this database. item text lives in the content bucket
-- and is delivered as a per-batch json behind a signed url. this schema only knows ids.

-- ---------------------------------------------------------------------------
-- item_index: the published bank's *metadata* (id -> bank / node / level). written by the
-- content pipeline's publish step (SPEC §3.5 step 6) with the service role. needed so the
-- server can pick look-ahead items by blueprint node and compute per-node readiness without
-- ever holding stems or options.
-- ---------------------------------------------------------------------------
create table public.item_index (
  item_id          public.item_id primary key,
  bank             public.bank_id not null,
  jurisdiction     text not null check (jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  blueprint_node   text not null,
  cognitive_level  text not null check (cognitive_level in ('knowledge', 'application', 'analysis')),
  license_level    text not null default 'both' check (license_level in ('salesperson', 'broker', 'both')),
  status           text not null check (status in ('published', 'retired')),
  content_version  int not null default 1,
  -- canary variants are not real bank items; they are assigned to accounts via canary_items.
  is_canary        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index item_index_bank_node_idx on public.item_index (bank, blueprint_node) where status = 'published' and not is_canary;
create index item_index_jurisdiction_idx on public.item_index (jurisdiction) where status = 'published';

create trigger item_index_set_updated_at
  before update on public.item_index
  for each row execute function public.fn_set_updated_at();

alter table public.item_index enable row level security;
-- service role only: exposing the id list to clients would make enumeration trivial.

-- ---------------------------------------------------------------------------
-- item_id_aliases: per-user public ids. the client only ever sees public_id.
-- ---------------------------------------------------------------------------
create table public.item_id_aliases (
  user_id     uuid not null references auth.users (id) on delete cascade,
  public_id   text not null,
  item_id     public.item_id not null references public.item_index (item_id),
  created_at  timestamptz not null default now(),
  primary key (user_id, item_id),
  unique (user_id, public_id)
);

alter table public.item_id_aliases enable row level security;
-- service role only. clients never need the mapping; the server translates in both directions.

-- return public ids for a set of item ids, creating aliases that do not exist yet.
create or replace function public.fn_alias_items(p_user_id uuid, p_item_ids text[])
returns table (item_id text, public_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  insert into public.item_id_aliases (user_id, public_id, item_id)
  select p_user_id, public.fn_random_token(12), x.id
  from unnest(p_item_ids) as x(id)
  -- named constraint: the out-columns item_id/public_id are plpgsql variables and would make a
  -- bare `on conflict (user_id, item_id)` ambiguous.
  on conflict on constraint item_id_aliases_pkey do nothing;

  return query
    select a.item_id::text, a.public_id
    from public.item_id_aliases a
    where a.user_id = p_user_id and a.item_id = any (p_item_ids);
end;
$$;

-- reverse lookup used by sync: public ids -> item ids for one user. unknown ids are dropped.
create or replace function public.fn_resolve_public_ids(p_user_id uuid, p_public_ids text[])
returns table (public_id text, item_id text)
language sql
stable
security definer
set search_path = public
as $$
  select a.public_id, a.item_id::text
  from public.item_id_aliases a
  where a.user_id = p_user_id and a.public_id = any (p_public_ids);
$$;

-- ---------------------------------------------------------------------------
-- canary_items: which canary variants were seeded into which account.
-- ---------------------------------------------------------------------------
create table public.canary_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  item_id      public.item_id not null references public.item_index (item_id),
  -- the real item this variant paraphrases (for pipeline bookkeeping).
  base_item_id public.item_id references public.item_index (item_id),
  created_at   timestamptz not null default now(),
  unique (user_id, item_id)
);
create index canary_items_item_idx on public.canary_items (item_id);

alter table public.canary_items enable row level security;
-- service role only. the user must never be able to tell which items are canaries.

-- make sure an account has p_count canaries assigned, drawing unassigned variants from the
-- pool of item_index rows with is_canary. returns the account's canary item ids.
create or replace function public.fn_ensure_canaries(p_user_id uuid, p_count int default 3)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_have int;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  select count(*) into v_have from public.canary_items c where c.user_id = p_user_id;
  if v_have < p_count then
    insert into public.canary_items (user_id, item_id)
    select p_user_id, i.item_id
    from public.item_index i
    where i.is_canary and i.status = 'published'
      and not exists (select 1 from public.canary_items c where c.user_id = p_user_id and c.item_id = i.item_id)
    -- prefer variants held by the fewest accounts so a leak points at a small set of users.
    order by (select count(*) from public.canary_items c2 where c2.item_id = i.item_id), random()
    limit (p_count - v_have)
    on conflict do nothing;
  end if;
  return query select c.item_id::text from public.canary_items c where c.user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- item_batches: every batch the server issued. the signature covers
-- (batch id, user id, public ids, expires_at) with a server hmac secret (see _shared/hmac.ts).
-- ---------------------------------------------------------------------------
create table public.item_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid references public.sessions (id) on delete set null,
  device_id     uuid references public.devices (id) on delete set null,
  kind          public.study_kind not null default 'practice',
  bank          public.bank_id not null,
  jurisdiction  text not null check (jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  form_id       text,                          -- mock form (F11), null for practice
  item_ids      text[] not null check (cardinality(item_ids) between 1 and 200),  -- SPEC §5.4: 50-200 (smaller only for the free tier / tail of a bank)
  public_ids    text[] not null check (cardinality(public_ids) = cardinality(item_ids)),
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  signature     text not null,
  content_path  text,                          -- storage object with the batch json
  created_at    timestamptz not null default now()
);
create index item_batches_user_issued_idx on public.item_batches (user_id, issued_at desc);

alter table public.item_batches enable row level security;

-- owners may list their batches (no item_ids: see the view below). inserts are service only.
create policy "item_batches: owner can read"
  on public.item_batches for select to authenticated
  using (user_id = auth.uid());

-- the client-facing shape never includes real item ids.
create or replace view public.v_my_batches
with (security_invoker = true) as
  select b.id, b.kind, b.bank, b.jurisdiction, b.form_id, b.public_ids, b.issued_at, b.expires_at,
         b.signature, (b.expires_at > now()) as valid
  from public.item_batches b
  where b.user_id = auth.uid();

-- distinct items ever delivered to a user (drives the free-tier 40-item cap, SPEC §6).
create or replace function public.fn_items_delivered_count(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct x.id)::int
  from public.item_batches b
  cross join lateral unnest(b.item_ids) as x(id)
  where b.user_id = p_user_id
    and not exists (select 1 from public.canary_items c where c.user_id = p_user_id and c.item_id = x.id);
$$;

-- item ids already delivered to the user (used to exclude them from look-ahead selection).
create or replace function public.fn_items_delivered(p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct x.id
  from public.item_batches b
  cross join lateral unnest(b.item_ids) as x(id)
  where b.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- rate_limits: fixed-window counters keyed by an arbitrary string ("items:<uid>").
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  created_at    timestamptz not null default now(),
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
-- service role only.

-- add p_cost to the current window and report whether the limit is still respected.
create or replace function public.fn_rate_limit_hit(
  p_key            text,
  p_limit          int,
  p_window_seconds int,
  p_cost           int default 1
)
returns table (allowed boolean, current_count int, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_count int;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_start, p_cost)
  on conflict (key, window_start) do update set count = public.rate_limits.count + excluded.count
  returning public.rate_limits.count into v_count;

  -- opportunistic garbage collection of stale windows (~1% of calls). replace with pg_cron later.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return query select (v_count <= p_limit), v_count, v_start + make_interval(secs => p_window_seconds);
end;
$$;
