-- 0006_progress.sql
-- F8 never lose progress: per-question rows, so a killed session resumes on the same question.
-- F10 red / yellow / green boxes with leech detection (missed 4+ times).
-- SPEC §3.5 step 7: per-item p-value monitoring (item_stats).
--
-- sync model: the client is offline-first (F7) and owns the srs scheduling. the server stores the
-- per-item aggregate and merges by last-write-wins on client_updated_at. item_stats is derived
-- from progress deltas by trigger, so it is correct no matter which path wrote the row.

create table public.progress (
  user_id            uuid not null references auth.users (id) on delete cascade,
  item_id            public.item_id not null references public.item_index (item_id),
  attempts           int not null default 0 check (attempts >= 0),
  correct            int not null default 0 check (correct >= 0 and correct <= attempts),
  last_answered_at   timestamptz,
  box                public.srs_box not null default 'red',
  due_at             timestamptz,
  -- F10: missed 4+ times -> leech, routed to a focused drill. maintained by trigger.
  leech              boolean not null default false,
  -- last-write-wins clock, set by the client at the moment of the answer.
  client_updated_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index progress_user_due_idx on public.progress (user_id, due_at);
create index progress_user_updated_idx on public.progress (user_id, updated_at);
create index progress_user_box_idx on public.progress (user_id, box);

alter table public.progress enable row level security;

-- owners can read and write their own rows directly (postgrest) or via fn_record_answers.
-- the lww trigger below makes direct writes safe.
create policy "progress: owner can read"
  on public.progress for select to authenticated
  using (user_id = auth.uid());
create policy "progress: owner can insert"
  on public.progress for insert to authenticated
  with check (user_id = auth.uid());
create policy "progress: owner can update"
  on public.progress for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- last-write-wins + derived columns. returning null from a before-update trigger skips the
-- write silently, which is exactly the lww semantics for a stale client row.
create or replace function public.fn_progress_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return null;
  end if;
  new.leech      := (new.attempts - new.correct) >= 4;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger progress_before_write
  before insert or update on public.progress
  for each row execute function public.fn_progress_before_write();

-- ---------------------------------------------------------------------------
-- item_stats: bank-wide attempts / correct per item. p = correct / attempts.
-- ---------------------------------------------------------------------------
create table public.item_stats (
  item_id     public.item_id primary key references public.item_index (item_id),
  attempts    bigint not null default 0,
  correct     bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.item_stats enable row level security;
-- service role only (content team dashboards). no client access.

-- apply the delta of a progress write to item_stats. security definer so a client-initiated
-- progress upsert (which has no item_stats policy) can still maintain the aggregate.
create or replace function public.fn_progress_to_item_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d_att int;
  d_cor int;
begin
  if tg_op = 'INSERT' then
    d_att := new.attempts;
    d_cor := new.correct;
  else
    d_att := new.attempts - old.attempts;
    d_cor := new.correct - old.correct;
  end if;
  -- a client reset never subtracts from bank-wide statistics.
  if d_att <= 0 then
    return null;
  end if;
  d_cor := greatest(0, least(d_cor, d_att));
  insert into public.item_stats (item_id, attempts, correct)
  values (new.item_id, d_att, d_cor)
  on conflict (item_id) do update
    set attempts   = public.item_stats.attempts + excluded.attempts,
        correct    = public.item_stats.correct + excluded.correct,
        updated_at = now();
  return null;
end;
$$;
create trigger progress_to_item_stats
  after insert or update on public.progress
  for each row execute function public.fn_progress_to_item_stats();

-- SPEC §3.5 step 7: items answered correctly by 95%+ or under 25% get re-reviewed.
-- minimum sample so a brand-new item is not flagged after three answers.
create or replace view public.v_item_pvalues as
  select s.item_id, i.bank, i.blueprint_node, i.cognitive_level, s.attempts, s.correct,
         round(s.correct::numeric / nullif(s.attempts, 0), 4) as p_value,
         case
           when s.attempts < 30 then 'insufficient_sample'
           when s.correct::numeric / s.attempts >= 0.95 then 'too_easy'
           when s.correct::numeric / s.attempts < 0.25 then 'too_hard'
           else 'ok'
         end as review_flag
  from public.item_stats s
  join public.item_index i on i.item_id = s.item_id;
revoke all on public.v_item_pvalues from anon, authenticated;

-- ---------------------------------------------------------------------------
-- study_sessions: resumable practice / mock runs. position + answers persist per question.
-- the id is generated by the client so it can be created offline and upserted later.
-- ---------------------------------------------------------------------------
create table public.study_sessions (
  id                 uuid primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  kind               public.study_kind not null,
  jurisdiction       text not null check (jurisdiction = 'NAT' or jurisdiction ~ '^[A-Z]{2}$'),
  bank               public.bank_id,
  form_id            text,                    -- F11 mock form, null for practice
  batch_id           uuid references public.item_batches (id) on delete set null,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  position           int not null default 0 check (position >= 0),
  -- [{ "public_id": "...", "choice": "B", "correct": true, "answered_at": "..." , "ms": 12000 }]
  answers            jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  time_remaining_s   int,                     -- mocks: remaining clock when the app was killed
  client_updated_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);
create index study_sessions_user_open_idx on public.study_sessions (user_id) where ended_at is null;

alter table public.study_sessions enable row level security;

create policy "study_sessions: owner can read"
  on public.study_sessions for select to authenticated
  using (user_id = auth.uid());
create policy "study_sessions: owner can insert"
  on public.study_sessions for insert to authenticated
  with check (user_id = auth.uid());
create policy "study_sessions: owner can update"
  on public.study_sessions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.fn_study_sessions_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.client_updated_at < old.client_updated_at then
      return null;                         -- lww: stale write dropped
    end if;
    new.created_at := old.created_at;
    new.user_id    := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger study_sessions_before_write
  before insert or update on public.study_sessions
  for each row execute function public.fn_study_sessions_before_write();

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

-- upsert one answered item atomically (progress + item_stats via trigger). the caller passes
-- the *public* id; it is resolved through the user's alias table so a client can never write
-- progress against a raw item id it should not know.
create or replace function public.fn_record_answer(
  p_user_id           uuid,
  p_public_id         text,
  p_attempts          int,
  p_correct           int,
  p_last_answered_at  timestamptz,
  p_box               public.srs_box,
  p_due_at            timestamptz,
  p_client_updated_at timestamptz
)
returns text  -- 'applied' | 'skipped_stale' | 'unknown_id'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id text;
  v_before  timestamptz;
  v_after   timestamptz;
begin
  perform public.fn_assert_owner(p_user_id);

  select a.item_id into v_item_id
  from public.item_id_aliases a
  where a.user_id = p_user_id and a.public_id = p_public_id;
  if v_item_id is null then
    return 'unknown_id';
  end if;

  select p.client_updated_at into v_before
  from public.progress p where p.user_id = p_user_id and p.item_id = v_item_id;

  insert into public.progress (user_id, item_id, attempts, correct, last_answered_at, box, due_at, client_updated_at)
  values (p_user_id, v_item_id, p_attempts, p_correct, p_last_answered_at, p_box, p_due_at, p_client_updated_at)
  on conflict (user_id, item_id) do update set
    attempts          = excluded.attempts,
    correct           = excluded.correct,
    last_answered_at  = excluded.last_answered_at,
    box               = excluded.box,
    due_at            = excluded.due_at,
    client_updated_at = excluded.client_updated_at;

  select p.client_updated_at into v_after
  from public.progress p where p.user_id = p_user_id and p.item_id = v_item_id;

  if v_before is not null and v_after = v_before and p_client_updated_at < v_before then
    return 'skipped_stale';
  end if;
  return 'applied';
end;
$$;

-- batch form used by the sync-progress edge function. p_rows is a json array of
-- { public_id, attempts, correct, last_answered_at, box, due_at, client_updated_at }.
-- returns one row per input with the outcome and the attempts delta actually applied
-- (the anomaly heuristics use the deltas to measure answer velocity).
create or replace function public.fn_record_answers(p_user_id uuid, p_rows jsonb)
returns table (public_id text, status text, attempts_delta int, last_answered_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r         jsonb;
  v_item    text;
  v_prev    int;
  v_status  text;
begin
  perform public.fn_assert_owner(p_user_id);
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    select a.item_id into v_item
    from public.item_id_aliases a
    where a.user_id = p_user_id and a.public_id = r->>'public_id';

    v_prev := null;
    if v_item is not null then
      select p.attempts into v_prev from public.progress p where p.user_id = p_user_id and p.item_id = v_item;
    end if;

    v_status := public.fn_record_answer(
      p_user_id,
      r->>'public_id',
      (r->>'attempts')::int,
      (r->>'correct')::int,
      (r->>'last_answered_at')::timestamptz,
      (r->>'box')::public.srs_box,
      (r->>'due_at')::timestamptz,
      (r->>'client_updated_at')::timestamptz
    );

    public_id        := r->>'public_id';
    status           := v_status;
    last_answered_at := (r->>'last_answered_at')::timestamptz;
    attempts_delta   := case when v_status = 'applied'
                             then greatest(0, (r->>'attempts')::int - coalesce(v_prev, 0))
                             else 0 end;
    return next;
  end loop;
end;
$$;

-- rows changed since a watermark, with public ids, for pulling server state onto a new device.
create or replace function public.fn_progress_since(p_user_id uuid, p_since timestamptz default '-infinity')
returns table (
  public_id text, attempts int, correct int, last_answered_at timestamptz,
  box public.srs_box, due_at timestamptz, leech boolean, client_updated_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.public_id, p.attempts, p.correct, p.last_answered_at, p.box, p.due_at, p.leech,
         p.client_updated_at, p.updated_at
  from public.progress p
  join public.item_id_aliases a on a.user_id = p.user_id and a.item_id = p.item_id
  where p.user_id = p_user_id
    and (auth.uid() = p_user_id or public.fn_is_service_role())
    and p.updated_at > p_since
  order by p.updated_at;
$$;

-- candidates for a batch: items due for review first, then unseen items from the requested bank
-- / nodes (look-ahead). the edge function does the final mix (see _shared/batch.ts).
create or replace function public.fn_batch_candidates(
  p_user_id   uuid,
  p_bank      public.bank_id,
  p_nodes     text[] default null,       -- null = whole bank; otherwise blueprint_node prefixes ("IV", "IV.B")
  p_due_limit int default 200,
  p_new_limit int default 200
)
returns table (item_id text, blueprint_node text, cognitive_level text, source text, box public.srs_box, due_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with scope as (
    select i.item_id, i.blueprint_node, i.cognitive_level
    from public.item_index i
    where i.bank = p_bank and i.status = 'published' and not i.is_canary
      and (p_nodes is null
           or exists (select 1 from unnest(p_nodes) n
                      where i.blueprint_node = n or i.blueprint_node like n || '.%'))
  ),
  due as (
    select s.item_id, s.blueprint_node, s.cognitive_level, 'due'::text as source, p.box, p.due_at
    from scope s
    join public.progress p on p.user_id = p_user_id and p.item_id = s.item_id
    where p.due_at is not null and p.due_at <= now()
    order by (p.box = 'red') desc, p.due_at
    limit p_due_limit
  ),
  fresh as (
    select s.item_id, s.blueprint_node, s.cognitive_level, 'new'::text as source, null::public.srs_box, null::timestamptz
    from scope s
    where not exists (select 1 from public.progress p where p.user_id = p_user_id and p.item_id = s.item_id)
      and s.item_id not in (select public.fn_items_delivered(p_user_id))
    order by random()
    limit p_new_limit
  )
  select c.*
  from (
    select * from due
    union all
    select * from fresh
  ) c
  where public.fn_is_service_role();
$$;

-- per-blueprint-node inputs for the readiness score (client-side formula; F20 study plan).
-- covers the state bank for p_jurisdiction plus the national banks (jurisdiction 'NAT'), or the
-- explicit p_banks list when given.
create or replace function public.fn_readiness_inputs(
  p_user_id      uuid,
  p_jurisdiction text,
  p_banks        text[] default null
)
returns table (
  bank text, blueprint_node text, domain text,
  items_total bigint, items_seen bigint, items_green bigint, items_leech bigint,
  attempts bigint, correct bigint, accuracy numeric, last_answered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.bank::text, i.blueprint_node, split_part(i.blueprint_node, '.', 1) as domain,
         count(*)                                     as items_total,
         count(p.item_id)                             as items_seen,
         count(*) filter (where p.box = 'green')      as items_green,
         count(*) filter (where p.leech)              as items_leech,
         coalesce(sum(p.attempts), 0)                 as attempts,
         coalesce(sum(p.correct), 0)                  as correct,
         round(sum(p.correct)::numeric / nullif(sum(p.attempts), 0), 4) as accuracy,
         max(p.last_answered_at)                      as last_answered_at
  from public.item_index i
  left join public.progress p on p.item_id = i.item_id and p.user_id = p_user_id
  where i.status = 'published' and not i.is_canary
    and (auth.uid() = p_user_id or public.fn_is_service_role())
    and case
          when p_banks is not null then i.bank = any (p_banks)
          else i.jurisdiction = p_jurisdiction or i.jurisdiction = 'NAT'
        end
  group by i.bank, i.blueprint_node
  order by i.bank, i.blueprint_node;
$$;

-- how many distinct mock forms has this user started (free tier allows 1, SPEC §6).
create or replace function public.fn_mock_forms_started(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct coalesce(s.form_id, s.id::text))::int
  from public.study_sessions s
  where s.user_id = p_user_id and s.kind = 'mock'
    and (auth.uid() = p_user_id or public.fn_is_service_role());
$$;
