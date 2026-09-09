-- 0013_support_reviews_coupons.sql
-- V2_PLAN §1/§2: support threads, learner reviews, admin coupons, entitlement pause.
--   support_tickets / support_messages — "contact us" threads the admin answers in the console
--   reviews                            — 1–5 stars + text; admin approves; approved ones are public
--   coupons / coupon_redemptions       — percent / amount (future web checkout) and gift (grants now)
--   entitlements.paused_until          — admin pause/resume without revoking

-- ---------------------------------------------------------------------------
-- support
-- ---------------------------------------------------------------------------
create table public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  subject     text not null check (char_length(subject) between 1 and 200),
  category    text not null default 'other'
              check (category in ('billing', 'content', 'bug', 'account', 'feature', 'other')),
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, updated_at desc);

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.fn_set_updated_at();

alter table public.support_tickets enable row level security;

create policy "support_tickets: owner can read"
  on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
create policy "support_tickets: owner can insert"
  on public.support_tickets for insert to authenticated
  with check (user_id = auth.uid());
-- owners may close their own ticket; everything else via the support / admin-api functions.
create policy "support_tickets: owner can update"
  on public.support_tickets for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  author      text not null check (author in ('user', 'admin')),
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 8000),
  created_at  timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

alter table public.support_messages enable row level security;

create policy "support_messages: participant can read"
  on public.support_messages for select to authenticated
  using (
    public.fn_is_admin()
    or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );
create policy "support_messages: owner can insert as user"
  on public.support_messages for insert to authenticated
  with check (
    author = 'user' and author_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

-- a learner reply reopens an answered ticket; an admin reply marks it answered.
create or replace function public.fn_support_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_tickets t
  set status = case when new.author = 'admin' then 'answered' else 'open' end
  where t.id = new.ticket_id and t.status <> 'closed';
  return null;
end;
$$;
create trigger support_messages_after_insert
  after insert on public.support_messages
  for each row execute function public.fn_support_messages_after_insert();

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  rating        int not null check (rating between 1 and 5),
  body          text check (body is null or char_length(body) <= 2000),
  jurisdiction  text check (jurisdiction is null or jurisdiction ~ '^[A-Z]{2}$'),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- shown on the landing page next to approved reviews ("Jane, FL"). set by the user, never the email.
  display_name  text check (display_name is null or char_length(display_name) <= 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reviews_status_idx on public.reviews (status, created_at desc);
create unique index reviews_user_uniq on public.reviews (user_id);   -- one review per account (editable)

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.fn_set_updated_at();

alter table public.reviews enable row level security;

create policy "reviews: owner can read"
  on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());
create policy "reviews: owner can insert"
  on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "reviews: owner can update"
  on public.reviews for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- an edited review goes back to pending; status is admin-owned.
create or replace function public.fn_reviews_protect_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.fn_is_internal_write() then
    if new.rating <> old.rating or coalesce(new.body, '') <> coalesce(old.body, '') then
      new.status := 'pending';
    else
      new.status := old.status;
    end if;
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger reviews_protect_status
  before update on public.reviews
  for each row execute function public.fn_reviews_protect_status();

-- public list for the landing page (anon + authenticated). no user ids or emails.
create or replace view public.v_public_reviews as
  select r.id, r.rating, r.body, r.jurisdiction, r.display_name, r.created_at
  from public.reviews r
  where r.status = 'approved'
  order by r.created_at desc;
grant select on public.v_public_reviews to anon, authenticated;

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------
create table public.coupons (
  code         text primary key check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  kind         text not null check (kind in ('percent', 'amount', 'gift')),
  -- percent: 1..100; amount: usd off; gift: ignored (grants the product outright).
  value        numeric(10, 2) not null default 0 check (value >= 0),
  product      public.product_kind not null default 'complete',
  max_uses     int not null default 1 check (max_uses >= 1),
  uses         int not null default 0 check (uses >= 0),
  expires_at   timestamptz,
  disabled_at  timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  constraint coupons_percent_range check (kind <> 'percent' or (value > 0 and value <= 100))
);
create index coupons_active_idx on public.coupons (created_at desc) where disabled_at is null;

alter table public.coupons enable row level security;
create policy "coupons: admin can read"
  on public.coupons for select to authenticated
  using (public.fn_is_admin());

create table public.coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null references public.coupons (code) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  redeemed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (code, user_id)
);
create index coupon_redemptions_user_idx on public.coupon_redemptions (user_id, redeemed_at desc);

alter table public.coupon_redemptions enable row level security;
create policy "coupon_redemptions: owner can read"
  on public.coupon_redemptions for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());

-- redeem a code for a user. gift codes grant the product now (source 'coupon', external_id = code);
-- percent / amount codes are validated and recorded so the web checkout can apply them later.
-- returns one row: ok, kind, product, value, error (null when ok).
create or replace function public.fn_redeem_coupon(p_user_id uuid, p_code text)
returns table (ok boolean, kind text, product public.product_kind, value numeric, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_coupon public.coupons%rowtype;
begin
  if not public.fn_is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;
  if char_length(v_code) = 12 then
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
  end if;

  select * into v_coupon from public.coupons c where c.code = v_code for update;
  if not found then
    return query select false, null::text, null::public.product_kind, null::numeric, 'invalid_code'::text; return;
  end if;
  if v_coupon.disabled_at is not null then
    return query select false, v_coupon.kind, v_coupon.product, v_coupon.value, 'coupon_disabled'::text; return;
  end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
    return query select false, v_coupon.kind, v_coupon.product, v_coupon.value, 'coupon_expired'::text; return;
  end if;
  if exists (select 1 from public.coupon_redemptions r where r.code = v_coupon.code and r.user_id = p_user_id) then
    return query select false, v_coupon.kind, v_coupon.product, v_coupon.value, 'already_redeemed'::text; return;
  end if;
  if v_coupon.uses >= v_coupon.max_uses then
    return query select false, v_coupon.kind, v_coupon.product, v_coupon.value, 'coupon_exhausted'::text; return;
  end if;
  if v_coupon.kind = 'gift' and public.fn_has_entitlement(p_user_id, v_coupon.product) then
    return query select false, v_coupon.kind, v_coupon.product, v_coupon.value, 'already_entitled'::text; return;
  end if;

  insert into public.coupon_redemptions (code, user_id) values (v_coupon.code, p_user_id);
  update public.coupons set uses = uses + 1 where code = v_coupon.code;

  if v_coupon.kind = 'gift' then
    perform public.fn_grant_entitlement(p_user_id, v_coupon.product, 'coupon'::public.entitlement_source,
      'coupon:' || v_coupon.code || ':' || p_user_id::text, null,
      jsonb_build_object('code', v_coupon.code, 'note', v_coupon.note));
  end if;

  insert into public.events (user_id, kind, props)
  values (p_user_id, 'coupon_redeemed', jsonb_build_object('code', v_coupon.code, 'kind', v_coupon.kind, 'product', v_coupon.product));

  return query select true, v_coupon.kind, v_coupon.product, v_coupon.value, null::text;
end;
$$;
revoke execute on function public.fn_redeem_coupon(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- entitlement pause (admin): a paused entitlement is not live until paused_until passes.
-- ---------------------------------------------------------------------------
alter table public.entitlements add column if not exists paused_until timestamptz;

create or replace function public.fn_has_entitlement(p_user_id uuid, p_product public.product_kind default 'complete')
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id and e.product = p_product and e.revoked_at is null
      and (e.paused_until is null or e.paused_until <= now())
  );
$$;
