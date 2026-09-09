-- 0009_admin.sql
-- Super-admin accounts (founder / internal QA): flagged on the profile and granted both products
-- with source 'manual' so the account works on web and mobile without a store purchase.
-- Grant with: select public.fn_make_admin('someone@example.com');  (service role / SQL editor only)

alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.fn_make_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email) limit 1;
  if v_user is null then
    raise exception 'no auth user with email %', p_email;
  end if;
  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;
  update public.profiles set is_admin = true, updated_at = now() where id = v_user;
  perform public.fn_grant_entitlement(v_user, 'complete'::public.product_kind, 'manual'::public.entitlement_source,
    'admin:' || v_user::text || ':complete', null, jsonb_build_object('reason', 'super_admin'));
  perform public.fn_grant_entitlement(v_user, 'pass_guarantee'::public.product_kind, 'manual'::public.entitlement_source,
    'admin:' || v_user::text || ':pass_guarantee', null, jsonb_build_object('reason', 'super_admin'));
  return v_user;
end;
$$;

revoke execute on function public.fn_make_admin(text) from public, anon, authenticated;
