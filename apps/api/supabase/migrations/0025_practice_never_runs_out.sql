-- 0025_practice_never_runs_out.sql
--
-- Practice must always work. Whatever is in the bank — five questions or a hundred — a learner who
-- opens Practice gets questions, chosen randomly, and their progress is kept. That is the product.
--
-- `fresh` only ever offered items with NO progress row, so once a learner had seen everything in a
-- bank the scope went empty, issue-batch answered 404, and the app showed "You are caught up — the
-- next batch comes back in 33 hours". Spaced repetition is a good reason to ORDER questions; it is
-- not a reason to refuse to show any. The schedule now decides what comes first, never whether
-- anything comes at all.
--
-- Order of preference within `fresh`:
--   1. never seen              (real new material first)
--   2. not held in a live batch (avoid duplicates inside one sitting)
--   3. random                  (a different mix every time)
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
  held as (
    select distinct x.id
    from public.item_batches b
    cross join lateral unnest(b.item_ids) as x(id)
    where b.user_id = p_user_id and b.expires_at > now()
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
    order by
      (exists (select 1 from public.progress p where p.user_id = p_user_id and p.item_id = s.item_id)),
      (exists (select 1 from held h where h.id = s.item_id)),
      random()
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
