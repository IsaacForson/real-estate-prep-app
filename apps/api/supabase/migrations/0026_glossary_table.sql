-- Glossary table: serves definitions from Supabase instead of the static manifest.
-- Pipeline publishes here; the app reads with the anon key via RLS.

create table if not exists public.glossary (
  id          uuid default gen_random_uuid() primary key,
  bank        text not null,
  term        text not null,
  definition  text not null,
  source      text not null,
  quoted_text text not null,
  related_terms text[] default '{}',
  items       text[] default '{}',
  status      text not null default 'approved',
  model       text,
  reviewer    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (bank, term)
);

alter table public.glossary enable row level security;

create policy "Anyone can read approved glossary"
  on public.glossary for select
  using (status in ('approved', 'quote_verified'));

comment on table public.glossary is 'Glossary terms grounded in statute text, published by the content pipeline.';
