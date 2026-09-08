-- 0002_profiles.sql
-- One profile per auth user. Created automatically by trigger on auth.users insert.

create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  -- F19 multi-state: the *home* jurisdiction drives the free tier ("one state", SPEC §6) and the
  -- default study plan. paid users can study any jurisdiction.
  home_jurisdiction       public.jurisdiction_code,
  -- F20: the exam date the study plan back-plans against.
  exam_date               date,
  -- SPEC §5.2 honest ux: the in-app notice "your readiness score assumes one person is answering.
  -- sharing this account will make it inaccurate." shown once; this records the acknowledgement.
  sharing_notice_ack      boolean not null default false,
  sharing_notice_ack_at   timestamptz,
  -- SPEC §5.3 single active session token. fk added in 0004 once sessions exists.
  current_session_id      uuid,
  -- set when the user completes a re-verification email (anomaly response, SPEC §5.3).
  last_reverified_at      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.fn_set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- owners may edit their study settings and the notice ack. current_session_id and
-- last_reverified_at are server-owned: the trigger below reverts client changes to them.
create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

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
  end if;
  if new.sharing_notice_ack and not old.sharing_notice_ack then
    new.sharing_notice_ack_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_protect_server_columns
  before update on public.profiles
  for each row execute function public.fn_profiles_protect_server_columns();

-- auto-create the profile row when supabase auth creates a user.
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- look up a user id by email. used by payment webhooks when the checkout did not carry our
-- user id in custom_data. security definer because auth.users is not exposed through the api.
create or replace function public.fn_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;
revoke execute on function public.fn_user_id_by_email(text) from public, anon, authenticated;
