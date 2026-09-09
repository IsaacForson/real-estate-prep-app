-- ---------------------------------------------------------------------------
-- 0019: two more rules that should not need a deploy to change.
--
-- 1. Guarantee terms. "90 days" and "five mocks" were literals inside
--    fn_guarantee_eligibility, which means the refund policy — the thing most likely to be
--    renegotiated once real claims arrive — could only move by shipping a migration. They are the
--    numbers the Refunds page judges every claim against, so they belong next to the other
--    operator-editable rules.
--
-- 2. Announcements. There was no way to tell every learner anything. When a state's statutes are
--    mid-update, or a store outage is blocking purchases, the alternative to a banner is answering
--    the same support ticket fifty times. It rides on v_app_runtime, which every client already
--    reads on boot, so it costs no new request.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  -- window_days runs from the guarantee purchase; mocks_required is what must be finished in-app
  -- before an attempt counts as prepared for.
  ('guarantee', '{"window_days": 90, "mocks_required": 5}'::jsonb),
  -- active is separate from message so an operator can retire a banner without losing its text.
  ('announcement', '{"active": false, "message": null, "tone": "info", "updated_at": null}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Clamped readers. A nonsensical setting must never make every claim eligible (or none), so the
-- bounds live here rather than trusting whatever json is in the row.
-- ---------------------------------------------------------------------------
create or replace function public.fn_guarantee_window_days()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select least(greatest(coalesce((public.fn_app_setting('guarantee', '{}'::jsonb) ->> 'window_days')::int, 90), 1), 730);
$$;

create or replace function public.fn_guarantee_mocks_required()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select least(greatest(coalesce((public.fn_app_setting('guarantee', '{}'::jsonb) ->> 'mocks_required')::int, 5), 0), 50);
$$;

-- Now policy-driven, and it reports the thresholds it used so the console can show the learner's
-- numbers against the rule in force rather than a hardcoded caption.
create or replace function public.fn_guarantee_eligibility(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_granted   timestamptz;
  v_complete  timestamptz;
  v_mocks     int;
  v_claimed   int;
  v_window    int := public.fn_guarantee_window_days();
  v_required  int := public.fn_guarantee_mocks_required();
begin
  perform public.fn_assert_admin();

  select min(e.granted_at) into v_granted from public.entitlements e
  where e.user_id = p_user_id and e.product = 'pass_guarantee' and e.revoked_at is null;
  select min(e.granted_at) into v_complete from public.entitlements e
  where e.user_id = p_user_id and e.product = 'complete' and e.revoked_at is null;

  select count(*)::int into v_mocks from public.study_sessions s
  where s.user_id = p_user_id and s.kind = 'mock' and s.status = 'finished';

  select count(*)::int into v_claimed from public.refund_requests r
  where r.user_id = p_user_id and r.status in ('approved', 'paid');

  return jsonb_build_object(
    'has_guarantee', v_granted is not null,
    'guarantee_granted_at', v_granted,
    'complete_granted_at', v_complete,
    'days_since_guarantee', case when v_granted is null then null else floor(extract(epoch from (now() - v_granted)) / 86400)::int end,
    'within_window', v_granted is not null and v_granted > now() - make_interval(days => v_window),
    'window_days', v_window,
    'mocks_completed', v_mocks,
    'mocks_required', v_required,
    'meets_mock_requirement', v_mocks >= v_required,
    -- "one refund per account"
    'already_refunded', v_claimed > 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The announcement travels on the view clients already read, and only when active, so an inactive
-- draft is never visible to a learner poking at the API.
-- ---------------------------------------------------------------------------
create or replace view public.v_app_runtime
with (security_invoker = true) as
  select
    public.fn_max_active_devices() as max_active_devices,
    coalesce((public.fn_app_setting('content_sync', '{"epoch": 1}'::jsonb) ->> 'epoch')::int, 1) as content_epoch,
    (public.fn_app_setting('content_sync', '{}'::jsonb) ->> 'last_synced_at')::timestamptz as content_synced_at,
    case
      when coalesce((public.fn_app_setting('announcement', '{}'::jsonb) ->> 'active')::boolean, false)
        then nullif(trim(coalesce(public.fn_app_setting('announcement', '{}'::jsonb) ->> 'message', '')), '')
      else null
    end as announcement,
    case
      when coalesce((public.fn_app_setting('announcement', '{}'::jsonb) ->> 'active')::boolean, false)
        then coalesce(public.fn_app_setting('announcement', '{}'::jsonb) ->> 'tone', 'info')
      else null
    end as announcement_tone,
    (public.fn_app_setting('announcement', '{}'::jsonb) ->> 'updated_at')::timestamptz as announcement_at;

grant select on public.v_app_runtime to authenticated, anon;
