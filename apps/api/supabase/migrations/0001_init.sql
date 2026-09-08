-- 0001_init.sql
-- Shared enums, helper functions and the audit log. Every later migration relies on this file.
--
-- Conventions (apply to every migration in this directory):
--   * lowercase sql, uuid primary keys, `created_at timestamptz not null default now()` on every table
--   * row level security on every table; users see only their own rows (auth.uid() = user_id)
--   * writes that must enforce a business rule go through `security definer` functions that call
--     fn_assert_owner(); the service role (edge functions, webhooks) bypasses rls
--   * no item text lives in this database (SPEC §5.4). only ids, metadata and statistics.

create extension if not exists pgcrypto; -- gen_random_bytes() for public ids and session tokens

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

-- SPEC §6: two products, both one-time. "complete" is the $59 everything-forever purchase,
-- "pass_guarantee" the +$20 add-on.
create type public.product_kind as enum ('complete', 'pass_guarantee');

-- SPEC §7: web sales through a merchant of record (Paddle / Lemon Squeezy), mobile through
-- RevenueCat. "manual" is a support grant (refund reversal, promo, site licence pilot).
create type public.entitlement_source as enum (
  'paddle', 'lemonsqueezy', 'revenuecat_ios', 'revenuecat_android', 'manual'
);

create type public.device_platform as enum ('ios', 'android', 'web');

-- F10: red / yellow / green leitner boxes.
create type public.srs_box as enum ('red', 'yellow', 'green');

create type public.study_kind as enum ('practice', 'mock');

-- SPEC §5.3 anomaly triggers. response is always a re-verification email, never a silent ban.
create type public.anomaly_kind as enum ('devices_30d', 'geo_24h', 'answer_velocity');

create type public.audit_actor as enum ('user', 'service', 'webhook', 'system');

-- The 51 licensing jurisdictions (mirrors packages/schema/src/jurisdictions.ts). Keep in sync.
create domain public.jurisdiction_code as text
  check (value in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
    'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ));

-- Bank ids (mirrors BANK_ID_RE in packages/schema/src/jurisdictions.ts).
create domain public.bank_id as text
  check (value ~ '^(national_pearsonvue|national_psi|state_[A-Z]{2})$');

-- Item ids (mirrors ITEM_ID_RE in packages/schema/src/item.ts). Canary variants use the
-- reserved prefix "CAN-" so they can never collide with a real bank item.
create domain public.item_id as text
  check (value ~ '^(NAT|[A-Z]{2})-[A-Z0-9]+(?:-[A-Z0-9]+)?-\d{4,}$' or value ~ '^CAN-[0-9a-f]{16}$');

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

-- true when the caller is the service role (edge functions, webhooks). service role also
-- bypasses rls, so this is only used to relax owner checks inside security definer functions.
create or replace function public.fn_is_service_role()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.role() = 'service_role', false);
$$;

-- true inside a security definer function that has called fn_begin_internal_write(), or for the
-- service role. column-protect triggers use it to tell "the server is writing" from "the client is
-- writing" when both run under the same authenticated jwt.
create or replace function public.fn_is_internal_write()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.fn_is_service_role()
      or coalesce(current_setting('app.internal_write', true), '') = 'on';
$$;

-- transaction-local flag (set_config(..., is_local => true)); postgrest runs one transaction per
-- request so the flag never leaks into another request.
create or replace function public.fn_begin_internal_write()
returns void
language sql
volatile
set search_path = public
as $$
  select set_config('app.internal_write', 'on', true);
$$;

-- raise unless the caller is the row owner or the service role.
create or replace function public.fn_assert_owner(p_user_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;
  if not (public.fn_is_service_role() or auth.uid() = p_user_id) then
    raise exception 'not the row owner' using errcode = '42501';
  end if;
end;
$$;

-- generic updated_at maintenance.
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- url-safe random id (default 12 bytes -> 16 chars base64url-ish). used for public item ids.
create or replace function public.fn_random_token(p_bytes int default 12)
returns text
language sql
volatile
set search_path = public
as $$
  select translate(encode(gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
-- SPEC §5.3: "log everything; act conservatively". append only. users can read entries about
-- themselves; only the service role (via fn_audit) writes.
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor       public.audit_actor not null,
  user_id     uuid references auth.users (id) on delete set null,
  action      text not null,            -- e.g. 'device.registered', 'entitlement.granted'
  target      text,                     -- free-form id of the affected row / external object
  details     jsonb not null default '{}'::jsonb,
  ip_hash     text,                     -- sha256 of the caller ip; never the raw ip
  created_at  timestamptz not null default now()
);
create index audit_log_user_created_idx on public.audit_log (user_id, created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

create policy "audit_log: owner can read"
  on public.audit_log for select to authenticated
  using (user_id = auth.uid());
-- no insert/update/delete policies: only the service role and fn_audit write.

create or replace function public.fn_audit(
  p_actor   public.audit_actor,
  p_user_id uuid,
  p_action  text,
  p_target  text default null,
  p_details jsonb default '{}'::jsonb,
  p_ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- a signed-in user may only audit themselves; the service role may audit anyone.
  if p_user_id is not null then
    perform public.fn_assert_owner(p_user_id);
  end if;
  insert into public.audit_log (actor, user_id, action, target, details, ip_hash)
  values (p_actor, p_user_id, p_action, p_target, coalesce(p_details, '{}'::jsonb), p_ip_hash)
  returning id into v_id;
  return v_id;
end;
$$;
