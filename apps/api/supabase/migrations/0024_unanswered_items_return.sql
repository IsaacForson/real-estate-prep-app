-- 0024_unanswered_items_return.sql
--
-- fn_batch_candidates permanently burned any item that had ever been delivered:
--
--     and s.item_id not in (select public.fn_items_delivered(p_user_id))
--
-- fn_items_delivered is derived from item_batches, so an item counted as "seen" the moment it was
-- put in a batch — whether or not the learner ever answered it. It could then never come back:
-- `due` needs a progress row (which only an answer creates) and `fresh` excluded it forever. A
-- learner who opened Practice, was shown ten questions and closed the app lost those ten for good,
-- and on the 20-question free tier would exhaust a state in two sittings without answering anything.
-- Observed on the founder's own account: every item of every bank it had touched was burned
-- (236/236 Pearson VUE, 157/157 PSI, 17/17 AZ, 34/34 AK) with zero progress rows, so issue-batch
-- answered 404 no_items for every state and Practice sat on its loader forever.
--
-- SPEC §5.4's protections are batch size, a short TTL, per-hour rate limits, per-user id aliases and
-- canaries. None of them depends on never re-issuing an item to the same account: re-showing someone
-- a question they never answered discloses nothing new, and the free tier counts DISTINCT delivered
-- items, so it cannot be inflated by a repeat.
--
-- So delivery is now a *preference*, not a filter. Items held in a live (unexpired) batch sort last
-- rather than being removed, which still avoids handing out duplicates mid-sitting but guarantees
-- the scope is never empty while unanswered items remain. Answered items stay out via `progress`.
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
  -- ids the learner is holding right now: still-valid batches only
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
    where not exists (select 1 from public.progress p where p.user_id = p_user_id and p.item_id = s.item_id)
    order by (exists (select 1 from held h where h.id = s.item_id)), random()
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
