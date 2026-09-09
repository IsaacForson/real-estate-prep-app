-- 0012_study_state.sql
-- V2_PLAN §1 "server is the source of truth": every piece of learner state is a row keyed by user_id.
--   study_state     — settings (home state, exam date, narration prefs, ...) + study plan, one row per user
--   study_sessions  — widened: item list, portions, time limit, status, device, score, finished_at (lww kept)
--   answers         — one row per answered question (the admin timeline + accuracy come from here)
--   progress        — widened to carry the client scheduler's streak / history so it round-trips exactly
--                     (chosen over a separate srs_cards table: keeps the 0006 lww trigger, item_stats
--                     delta trigger and fn_record_answers untouched in spirit)

-- ---------------------------------------------------------------------------
-- study_state
-- ---------------------------------------------------------------------------
create table public.study_state (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  settings           jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  plan               jsonb check (plan is null or jsonb_typeof(plan) = 'object'),
  client_updated_at  timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.study_state enable row level security;

create policy "study_state: owner can read"
  on public.study_state for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
create policy "study_state: owner can insert"
  on public.study_state for insert to authenticated
  with check (user_id = auth.uid());
create policy "study_state: owner can update"
  on public.study_state for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.fn_study_state_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.client_updated_at < old.client_updated_at then
      return null;                       -- lww: stale write dropped
    end if;
    new.created_at := old.created_at;
    new.user_id    := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger study_state_before_write
  before insert or update on public.study_state
  for each row execute function public.fn_study_state_before_write();

-- merge a settings patch / plan atomically (used by the study-state function; the client may also
-- upsert the row directly under rls).
create or replace function public.fn_study_state_put(
  p_user_id           uuid,
  p_settings_patch    jsonb default null,
  p_plan              jsonb default null,
  p_replace_plan      boolean default false,
  p_client_updated_at timestamptz default now()
)
returns public.study_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.study_state;
begin
  perform public.fn_assert_owner(p_user_id);
  insert into public.study_state (user_id, settings, plan, client_updated_at)
  values (p_user_id, coalesce(p_settings_patch, '{}'::jsonb), p_plan, p_client_updated_at)
  on conflict (user_id) do update
    set settings          = public.study_state.settings || coalesce(excluded.settings, '{}'::jsonb),
        plan              = case when p_replace_plan or excluded.plan is not null then excluded.plan else public.study_state.plan end,
        client_updated_at = excluded.client_updated_at;
  select * into v_row from public.study_state where user_id = p_user_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- study_sessions: widen
-- ---------------------------------------------------------------------------
alter table public.study_sessions
  add column if not exists item_ids      text[] not null default '{}'::text[],   -- *public* ids, in order
  add column if not exists portions      jsonb check (portions is null or jsonb_typeof(portions) = 'array'),
  add column if not exists time_limit_ms int check (time_limit_ms is null or time_limit_ms > 0),
  add column if not exists status        text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  add column if not exists device_hash   text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists score         numeric(6, 4) check (score is null or (score >= 0 and score <= 1)),
  add column if not exists finished_at   timestamptz,
  add column if not exists time_used_s   int check (time_used_s is null or time_used_s >= 0);

-- keep ended_at / finished_at / status coherent whichever one a writer sets.
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
    -- a finished mock is immutable for the client: keep the server score / item list.
    if old.status = 'finished' and not public.fn_is_internal_write() then
      new.status      := old.status;
      new.score       := old.score;
      new.item_ids    := old.item_ids;
      new.finished_at := old.finished_at;
      new.ended_at    := old.ended_at;
    end if;
  end if;
  if new.finished_at is null and new.ended_at is not null then new.finished_at := new.ended_at; end if;
  if new.ended_at is null and new.finished_at is not null then new.ended_at := new.finished_at; end if;
  if new.finished_at is not null and new.status = 'active' then new.status := 'finished'; end if;
  if new.status <> 'active' and new.finished_at is null then
    new.finished_at := now();
    new.ended_at    := new.finished_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create index if not exists study_sessions_user_status_idx on public.study_sessions (user_id, status, started_at desc);
create index if not exists study_sessions_finished_idx on public.study_sessions (finished_at desc) where finished_at is not null;

-- ---------------------------------------------------------------------------
-- answers
-- ---------------------------------------------------------------------------
create table public.answers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- what the client knows: its per-user public id. the real item id is resolved by trigger.
  public_id    text not null check (char_length(public_id) between 1 and 64),
  item_id      public.item_id,
  session_id   uuid references public.study_sessions (id) on delete set null,
  chosen       text check (chosen is null or chosen in ('A', 'B', 'C', 'D')),
  correct      boolean not null,
  ms           int check (ms is null or ms >= 0),
  answered_at  timestamptz not null default now(),
  device_hash  text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);
create index answers_user_answered_idx on public.answers (user_id, answered_at desc);
create index answers_session_idx on public.answers (session_id) where session_id is not null;
create index answers_item_idx on public.answers (item_id) where item_id is not null;
create index answers_answered_idx on public.answers (answered_at desc);
-- one row per (session, question): a resumed session re-sending an answer is an upsert, not a dup.
create unique index answers_session_public_uniq on public.answers (session_id, public_id) where session_id is not null;

alter table public.answers enable row level security;

create policy "answers: owner can read"
  on public.answers for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
create policy "answers: owner can insert"
  on public.answers for insert to authenticated
  with check (user_id = auth.uid());
create policy "answers: owner can update"
  on public.answers for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- resolve the public id to the real item id (security definer: item_id_aliases has no client policy).
create or replace function public.fn_answers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
  end if;
  if new.item_id is null or tg_op = 'INSERT' then
    select a.item_id into new.item_id
    from public.item_id_aliases a
    where a.user_id = new.user_id and a.public_id = new.public_id;
  end if;
  return new;
end;
$$;
create trigger answers_before_write
  before insert or update on public.answers
  for each row execute function public.fn_answers_before_write();

-- ---------------------------------------------------------------------------
-- progress: carry the client scheduler's extra fields so a new device restores the exact state
-- ---------------------------------------------------------------------------
alter table public.progress
  add column if not exists streak  int not null default 0 check (streak >= 0),
  add column if not exists history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array');

-- fn_record_answer gains streak + history (optional). drop the old signature so rpc resolution is
-- unambiguous, then recreate the batch wrapper and the pull function on top of it.
drop function if exists public.fn_record_answers(uuid, jsonb);
drop function if exists public.fn_record_answer(uuid, text, int, int, timestamptz, public.srs_box, timestamptz, timestamptz);

create or replace function public.fn_record_answer(
  p_user_id           uuid,
  p_public_id         text,
  p_attempts          int,
  p_correct           int,
  p_last_answered_at  timestamptz,
  p_box               public.srs_box,
  p_due_at            timestamptz,
  p_client_updated_at timestamptz,
  p_streak            int default null,
  p_history           jsonb default null
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

  insert into public.progress (user_id, item_id, attempts, correct, last_answered_at, box, due_at, client_updated_at, streak, history)
  values (p_user_id, v_item_id, p_attempts, p_correct, p_last_answered_at, p_box, p_due_at, p_client_updated_at,
          coalesce(p_streak, 0), coalesce(p_history, '[]'::jsonb))
  on conflict (user_id, item_id) do update set
    attempts          = excluded.attempts,
    correct           = excluded.correct,
    last_answered_at  = excluded.last_answered_at,
    box               = excluded.box,
    due_at            = excluded.due_at,
    client_updated_at = excluded.client_updated_at,
    streak            = coalesce(p_streak, public.progress.streak),
    history           = coalesce(p_history, public.progress.history);

  select p.client_updated_at into v_after
  from public.progress p where p.user_id = p_user_id and p.item_id = v_item_id;

  if v_before is not null and v_after = v_before and p_client_updated_at < v_before then
    return 'skipped_stale';
  end if;
  return 'applied';
end;
$$;

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
      (r->>'client_updated_at')::timestamptz,
      (r->>'streak')::int,
      case when jsonb_typeof(r->'history') = 'array' then r->'history' else null end
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

drop function if exists public.fn_progress_since(uuid, timestamptz);
create or replace function public.fn_progress_since(p_user_id uuid, p_since timestamptz default '-infinity')
returns table (
  public_id text, attempts int, correct int, last_answered_at timestamptz,
  box public.srs_box, due_at timestamptz, leech boolean, streak int, history jsonb,
  client_updated_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.public_id, p.attempts, p.correct, p.last_answered_at, p.box, p.due_at, p.leech, p.streak, p.history,
         p.client_updated_at, p.updated_at
  from public.progress p
  join public.item_id_aliases a on a.user_id = p.user_id and a.item_id = p.item_id
  where p.user_id = p_user_id
    and (auth.uid() = p_user_id or public.fn_is_service_role())
    and p.updated_at > p_since
  order by p.updated_at;
$$;

-- the client-facing shape of an srs card: progress by *public* id. security definer so the alias
-- join works under rls; scoped to the caller.
create or replace function public.fn_my_srs_cards()
returns table (
  public_id text, box public.srs_box, due_at timestamptz, attempts int, correct int, streak int,
  leech boolean, last_answered_at timestamptz, history jsonb, client_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.public_id, p.box, p.due_at, p.attempts, p.correct, p.streak, p.leech, p.last_answered_at, p.history,
         p.client_updated_at
  from public.progress p
  join public.item_id_aliases a on a.user_id = p.user_id and a.item_id = p.item_id
  where p.user_id = auth.uid();
$$;
