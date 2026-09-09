-- ---------------------------------------------------------------------------
-- 0020: free-tier home state is chosen once.
--
-- profiles.home_jurisdiction is what issue-batch uses to refuse other state banks. The client
-- already tried to lock it, but the update policy lets the owner write any column, so a free
-- account could keep flipping states. Complete may still move (they paid for all 51).
-- ---------------------------------------------------------------------------

create or replace function public.fn_profiles_protect_server_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.fn_is_internal_write() then
    new.current_session_id := old.current_session_id;
    new.last_reverified_at := old.last_reverified_at;
    new.created_at         := old.created_at;

    -- first write sticks for anyone who has not bought Complete
    if old.home_jurisdiction is not null
       and new.home_jurisdiction is distinct from old.home_jurisdiction
       and not exists (
         select 1 from public.entitlements e
         where e.user_id = new.id and e.product = 'complete' and e.revoked_at is null
       )
    then
      new.home_jurisdiction := old.home_jurisdiction;
    end if;
  end if;
  if new.sharing_notice_ack and not old.sharing_notice_ack then
    new.sharing_notice_ack_at := now();
  end if;
  return new;
end;
$$;
