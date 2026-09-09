-- 0010_v2_enums.sql
-- V2 (docs/V2_PLAN.md §2): enum additions on their own so later migrations can use the new values
-- (postgres refuses to *use* a value added by `alter type ... add value` inside the same transaction).
--
--   anomaly_kind        + 'device_accounts'  — one device used by >= 3 accounts in 30 days
--   entitlement_source  + 'coupon'           — 100 % / gift coupon redeemed via redeem-coupon

alter type public.anomaly_kind add value if not exists 'device_accounts';
alter type public.entitlement_source add value if not exists 'coupon';

-- helper used by the admin policies / functions from 0013 on. lives here because 0011+ reference it.
create or replace function public.fn_is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_user_id), false);
$$;
