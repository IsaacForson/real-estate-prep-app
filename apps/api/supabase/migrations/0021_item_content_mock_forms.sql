-- 0021_item_content_mock_forms.sql
-- "Never an empty screen": the initial set of real questions and the mock forms live in the
-- database, not only in the private storage bucket.
--
--   item_content  — the published Item JSON per item (same document `pipeline publish --remote`
--                   uploads to content/items/<bank>/<id>.json). content-store.ts reads it first and
--                   falls back to the bucket only for ids missing here. Service role only.
--   mock_forms    — assembled, non-overlapping forms (`pipeline forms-build`). mock-start uses a row
--                   when one exists and draws fresh only when none does. Service role only; the
--                   client lists forms through v_mock_forms, which never exposes item ids.
--   fn_admin_content_summary() — per-bank counts for /admin/content.

-- ---------------------------------------------------------------------------
-- item_content
-- ---------------------------------------------------------------------------
create table public.item_content (
  item_id          public.item_id primary key references public.item_index (item_id) on delete cascade,
  bank             public.bank_id not null,
  jurisdiction     text not null check (jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  body             jsonb not null check (jsonb_typeof(body) = 'object'),
  content_version  int not null default 1,
  updated_at       timestamptz not null default now()
);
create index item_content_bank_idx on public.item_content (bank);

create trigger item_content_set_updated_at
  before update on public.item_content
  for each row execute function public.fn_set_updated_at();

alter table public.item_content enable row level security;
-- no policies: service role only. item text never leaves the server except inside a signed batch.
revoke all on public.item_content from anon, authenticated;

-- ---------------------------------------------------------------------------
-- mock_forms
-- ---------------------------------------------------------------------------
create table public.mock_forms (
  -- deterministic: '<bank>:<jurisdiction|NAT>:<form_id>' so the pipeline can upsert by primary key
  id            text primary key,
  bank          public.bank_id not null,
  jurisdiction  text check (jurisdiction is null or jurisdiction ~ '^[A-Z]{2}$'),
  form_id       text not null check (form_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  title         text not null,
  item_ids      text[] not null check (cardinality(item_ids) between 1 and 200),
  time_limit_s  int not null check (time_limit_s > 0),
  pass_score    numeric(5, 4) not null check (pass_score > 0 and pass_score <= 1),
  -- [{ portion: 'national'|'state', bank, item_ids: text[], pass_score: text|null }]
  portions      jsonb not null default '[]'::jsonb check (jsonb_typeof(portions) = 'array'),
  status        text not null default 'active' check (status in ('active', 'retired')),
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique nulls not distinct (bank, jurisdiction, form_id)
);
create index mock_forms_lookup_idx on public.mock_forms (form_id, jurisdiction, bank) where status = 'active';

create trigger mock_forms_set_updated_at
  before update on public.mock_forms
  for each row execute function public.fn_set_updated_at();

alter table public.mock_forms enable row level security;
revoke all on public.mock_forms from anon, authenticated;

-- what the client may know about a form: never the item ids.
create or replace view public.v_mock_forms as
  select f.id, f.bank, f.jurisdiction, f.form_id, f.title,
         cardinality(f.item_ids) as item_count,
         f.time_limit_s, f.pass_score,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'portion', p->>'portion', 'bank', p->>'bank',
                   'count', jsonb_array_length(coalesce(p->'item_ids', '[]'::jsonb)),
                   'pass_score', p->>'pass_score')), '[]'::jsonb)
            from jsonb_array_elements(f.portions) p) as portions,
         f.published_at
  from public.mock_forms f
  where f.status = 'active';
grant select on public.v_mock_forms to anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_admin_content_summary() -> per bank: items_published, forms, last_published_at
-- ---------------------------------------------------------------------------
create or replace function public.fn_admin_content_summary()
returns table (bank text, items_published int, items_in_db int, forms int, last_published_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_assert_admin();
  return query
    with banks as (
      select i.bank::text as bank from public.item_index i
      union select f.bank::text from public.mock_forms f
    )
    select b.bank,
           (select count(*)::int from public.item_index i where i.bank::text = b.bank and i.status = 'published' and not i.is_canary),
           (select count(*)::int from public.item_content c where c.bank::text = b.bank),
           (select count(*)::int from public.mock_forms f where f.bank::text = b.bank and f.status = 'active'),
           greatest(
             (select max(c.updated_at) from public.item_content c where c.bank::text = b.bank),
             (select max(i.updated_at) from public.item_index i where i.bank::text = b.bank and i.status = 'published'),
             (select max(f.published_at) from public.mock_forms f where f.bank::text = b.bank)
           )
    from banks b
    order by b.bank;
end;
$$;
