-- 0003_entitlements.sql
-- SPEC §6 / §7: one-time purchases, "forever". an entitlement is a row that has not been revoked.
-- granted and revoked only by payment webhooks (service role) or support (source = 'manual').

create table public.entitlements (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  product               public.product_kind not null,
  source                public.entitlement_source not null,
  -- provider object that proves the purchase: paddle transaction id, lemon squeezy order id,
  -- revenuecat (original_)transaction_id. null only for manual grants.
  external_id           text,
  -- provider customer / app user id, for support lookups.
  external_customer_id  text,
  meta                  jsonb not null default '{}'::jsonb,
  granted_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  revoke_reason         text,          -- 'refund', 'chargeback', 'transfer', 'support'
  created_at            timestamptz not null default now()
);

create index entitlements_user_idx on public.entitlements (user_id) where revoked_at is null;
-- idempotency: the same provider object grants the same product exactly once.
create unique index entitlements_external_uniq
  on public.entitlements (source, external_id, product)
  where external_id is not null;

alter table public.entitlements enable row level security;

create policy "entitlements: owner can read"
  on public.entitlements for select to authenticated
  using (user_id = auth.uid());
-- no client write policies. grants come from webhooks / support via the functions below.

-- ---------------------------------------------------------------------------
-- webhook_events: raw provider events, unique per (provider, event id). the webhook edge
-- functions insert first and stop on conflict, which makes every handler idempotent.
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('paddle', 'lemonsqueezy', 'revenuecat')),
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  result        text,                  -- 'granted' | 'revoked' | 'ignored' | 'unmatched_user' | 'error: ...'
  created_at    timestamptz not null default now(),
  unique (provider, event_id)
);

alter table public.webhook_events enable row level security;
-- service role only. no policies on purpose.

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------

create or replace function public.fn_has_entitlement(p_user_id uuid, p_product public.product_kind default 'complete')
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id and e.product = p_product and e.revoked_at is null
  );
$$;

-- grant (or re-grant after a refund reversal). idempotent on (source, external_id, product).
create or replace function public.fn_grant_entitlement(
  p_user_id              uuid,
  p_product              public.product_kind,
  p_source               public.entitlement_source,
  p_external_id          text,
  p_external_customer_id text default null,
  p_meta                 jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.fn_is_service_role() then
    raise exception 'entitlements are granted by the service role only' using errcode = '42501';
  end if;

  if p_external_id is null then
    insert into public.entitlements (user_id, product, source, external_id, external_customer_id, meta)
    values (p_user_id, p_product, p_source, null, p_external_customer_id, coalesce(p_meta, '{}'::jsonb))
    returning id into v_id;
  else
    insert into public.entitlements (user_id, product, source, external_id, external_customer_id, meta)
    values (p_user_id, p_product, p_source, p_external_id, p_external_customer_id, coalesce(p_meta, '{}'::jsonb))
    on conflict (source, external_id, product) where external_id is not null
    do update set
      revoked_at    = null,
      revoke_reason = null,
      meta          = public.entitlements.meta || excluded.meta
    returning id into v_id;
  end if;

  perform public.fn_audit('webhook', p_user_id, 'entitlement.granted', v_id::text,
    jsonb_build_object('product', p_product, 'source', p_source, 'external_id', p_external_id));
  return v_id;
end;
$$;

-- revoke every live entitlement that came from this provider object (refund / chargeback).
create or replace function public.fn_revoke_entitlement(
  p_source      public.entitlement_source,
  p_external_id text,
  p_reason      text default 'refund',
  p_product     public.product_kind default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  if not public.fn_is_service_role() then
    raise exception 'entitlements are revoked by the service role only' using errcode = '42501';
  end if;

  for r in
    update public.entitlements e
    set revoked_at = now(), revoke_reason = p_reason
    where e.source = p_source
      and e.external_id = p_external_id
      and e.revoked_at is null
      and (p_product is null or e.product = p_product)
    returning e.id, e.user_id, e.product
  loop
    v_count := v_count + 1;
    perform public.fn_audit('webhook', r.user_id, 'entitlement.revoked', r.id::text,
      jsonb_build_object('reason', p_reason, 'source', p_source, 'external_id', p_external_id, 'product', r.product));
  end loop;

  return v_count;
end;
$$;

-- revenuecat TRANSFER: the store purchase moved to another app user id (same apple/google
-- account signed into a different account). move the live entitlements with it.
create or replace function public.fn_transfer_entitlements(
  p_from_user uuid,
  p_to_user   uuid,
  p_source    public.entitlement_source
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  update public.entitlements
  set user_id = p_to_user,
      meta    = meta || jsonb_build_object('transferred_from', p_from_user, 'transferred_at', now())
  where user_id = p_from_user and source = p_source and revoked_at is null;
  get diagnostics v_count = row_count;
  perform public.fn_audit('webhook', p_to_user, 'entitlement.transferred', null,
    jsonb_build_object('from', p_from_user, 'source', p_source, 'count', v_count));
  return v_count;
end;
$$;

revoke execute on function public.fn_grant_entitlement(uuid, public.product_kind, public.entitlement_source, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fn_revoke_entitlement(public.entitlement_source, text, text, public.product_kind) from public, anon, authenticated;
revoke execute on function public.fn_transfer_entitlements(uuid, uuid, public.entitlement_source) from public, anon, authenticated;
