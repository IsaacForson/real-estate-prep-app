-- behavioural smoke test for the migrations, run by scripts/pg-smoke.sh after pg-shim.sql,
-- migrations/*.sql and seed.sql. every `select ... as <name>` should print t / the stated value.
-- impersonation mirrors postgrest: set request.jwt.claims + set role.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false), set_config('role', 'service_role', false) $$;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u)::text, false), set_config('role', 'authenticated', false) $$;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com');

\echo [1] profile auto-created by trigger
select count(*) = 2 as ok from public.profiles;

select pg_temp.as_service();
\echo [2] SPEC 5.3 (0015): one active device; each new sign-in takes the slot over, never refused
select device_id is not null as ok, created, superseded = 0 as first_supersedes_nothing
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ios', 'phone');
select created, superseded = 1 as tablet_kicked_phone
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('b',64), 'android', 'tablet');
select created, superseded = 1 as laptop_kicked_tablet
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('c',64), 'web', 'laptop');
select public.fn_active_device_count('11111111-1111-4111-8111-111111111111') = 1 as exactly_one_active;
-- the case 0015 exists to fix: a fourth device just works instead of raising P0003
select device_id is not null as fourth_device_ok
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('d',64), 'web', 'fourth');
-- and the phone can come straight back, with no cooldown in the way
select superseded = 1 as phone_reclaims_slot
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ios', 'phone');

\echo [3] SPEC 5.3: single live session
select count(*) filter (where revoked_at is null) = 1 as one_live, count(*) = 5 as five_total
from public.sessions where user_id = '11111111-1111-4111-8111-111111111111';
select p.current_session_id = s.id as profile_points_at_live
from public.profiles p join public.sessions s on s.user_id = p.id and s.revoked_at is null
where p.id = '11111111-1111-4111-8111-111111111111';
select public.fn_session_is_valid('11111111-1111-4111-8111-111111111111', p.current_session_id, s.device_id) as valid
from public.profiles p join public.sessions s on s.id = p.current_session_id
where p.id = '11111111-1111-4111-8111-111111111111';

\echo [4] SPEC 5.3 (0015): removal frees the slot immediately, no cooldown
select public.fn_remove_device('11111111-1111-4111-8111-111111111111', d.id) <= now() as removed_now
from public.devices d where d.fingerprint_hash = repeat('a',64);
select public.fn_active_device_count('11111111-1111-4111-8111-111111111111') = 0 as slot_free;
select count(*) = 0 as no_cooldowns_anywhere from public.devices where cooldown_until is not null;
select public.fn_can_register_device('11111111-1111-4111-8111-111111111111', repeat('d',64)) as always_true;
-- the removed device signs back in with no wait
select device_id is not null as removed_device_returns
from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ios', 'phone');

\echo [5] entitlement grant is idempotent; revoke; re-grant after reversal
select public.fn_grant_entitlement('11111111-1111-4111-8111-111111111111','complete','paddle','txn_1','ctm_1','{}') is not null as granted;
select public.fn_grant_entitlement('11111111-1111-4111-8111-111111111111','complete','paddle','txn_1','ctm_1','{"again":true}') is not null as regranted;
select count(*) = 1 as one_row from public.entitlements;
select public.fn_has_entitlement('11111111-1111-4111-8111-111111111111') as has_true;
select public.fn_revoke_entitlement('paddle','txn_1','refund') = 1 as revoked_one;
select public.fn_has_entitlement('11111111-1111-4111-8111-111111111111') as has_after_revoke_false;
select public.fn_grant_entitlement('11111111-1111-4111-8111-111111111111','complete','paddle','txn_1','ctm_1','{}') is not null as regrant;
select public.fn_has_entitlement('11111111-1111-4111-8111-111111111111') as has_again_true;

\echo [6] SPEC 5.4: candidates, per-user aliases, canaries, delivered count
select source, count(*) from public.fn_batch_candidates('11111111-1111-4111-8111-111111111111','national_pearsonvue', null, 50, 50) group by 1;
select count(*) as iv_scoped_3 from public.fn_batch_candidates('11111111-1111-4111-8111-111111111111','national_pearsonvue', array['IV'], 50, 50);
select count(*) = 3 as aliased, count(distinct public_id) = 3 as distinct_pub
from public.fn_alias_items('11111111-1111-4111-8111-111111111111', array['NAT-PV-I-0001','NAT-PV-I-0002','NAT-PV-IV-0001']);
select count(*) = 3 as stable_second_call
from public.fn_alias_items('11111111-1111-4111-8111-111111111111', array['NAT-PV-I-0001','NAT-PV-I-0002','NAT-PV-IV-0001']);
select count(*) = 3 as canaries from public.fn_ensure_canaries('11111111-1111-4111-8111-111111111111', 3);
insert into public.item_batches (user_id, kind, bank, jurisdiction, item_ids, public_ids, expires_at, signature)
select '11111111-1111-4111-8111-111111111111','practice','national_pearsonvue','NAT', array_agg(item_id), array_agg(public_id), now() + interval '6 hours', 'sig'
from public.fn_alias_items('11111111-1111-4111-8111-111111111111', array['NAT-PV-I-0001','NAT-PV-I-0002','NAT-PV-IV-0001']);
select public.fn_items_delivered_count('11111111-1111-4111-8111-111111111111') = 3 as delivered_three;
select count(*) as fresh_after_delivery_9 from public.fn_batch_candidates('11111111-1111-4111-8111-111111111111','national_pearsonvue', null, 50, 50) where source = 'new';

\echo [7] rate limit window
select allowed as allowed_t, current_count from public.fn_rate_limit_hit('items:test', 5, 3600, 3);
select allowed as allowed_f, current_count from public.fn_rate_limit_hit('items:test', 5, 3600, 3);

\echo [8] F8/F10: record answers by public id as the user; lww; item_stats delta; leech
create temp table pubs as select * from public.fn_alias_items('11111111-1111-4111-8111-111111111111', array['NAT-PV-I-0001','NAT-PV-I-0002']);
grant select on pubs to authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select count(*) = 0 as aliases_hidden_from_user from public.item_id_aliases;
select status, attempts_delta from public.fn_record_answers('11111111-1111-4111-8111-111111111111', (
  select jsonb_agg(jsonb_build_object('public_id', public_id, 'attempts', 1, 'correct', 1, 'last_answered_at', now(), 'box', 'yellow', 'due_at', now() + interval '1 day', 'client_updated_at', '2026-09-08T10:00:00Z')) from pubs));
select status as stale_row from public.fn_record_answers('11111111-1111-4111-8111-111111111111', (
  select jsonb_agg(jsonb_build_object('public_id', public_id, 'attempts', 0, 'correct', 0, 'last_answered_at', null, 'box', 'red', 'due_at', null, 'client_updated_at', '2026-09-08T09:00:00Z')) from pubs));
select status, attempts_delta as delta_4 from public.fn_record_answers('11111111-1111-4111-8111-111111111111', (
  select jsonb_agg(jsonb_build_object('public_id', public_id, 'attempts', 5, 'correct', 1, 'last_answered_at', now(), 'box', 'red', 'due_at', now() - interval '1 hour', 'client_updated_at', '2026-09-08T11:00:00Z')) from (select * from pubs limit 1) x));
select status as unknown_row from public.fn_record_answers('11111111-1111-4111-8111-111111111111',
  '[{"public_id":"nope","attempts":1,"correct":1,"box":"red","client_updated_at":"2026-09-08T11:00:00Z"}]'::jsonb);
select item_id, attempts, correct, box, leech from public.progress where user_id = '11111111-1111-4111-8111-111111111111' order by item_id;
select pg_temp.as_service();
select item_id, attempts, correct from public.item_stats order by item_id;

\echo [9] readiness inputs + progress_since as the user
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select bank, blueprint_node, items_total, items_seen, attempts, correct, accuracy
from public.fn_readiness_inputs('11111111-1111-4111-8111-111111111111','FL') where items_seen > 0;
select count(*) as rows_since_2 from public.fn_progress_since('11111111-1111-4111-8111-111111111111', '1970-01-01');
select count(*) as candidates_as_user_0 from public.fn_batch_candidates('11111111-1111-4111-8111-111111111111','national_pearsonvue', null, 50, 50);

\echo [10] rls: bob sees nothing of alice; writes to service tables and foreign rows are refused
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (select count(*) from public.progress) = 0 as no_progress,
       (select count(*) from public.v_my_devices) = 0 as no_devices,
       (select count(*) from public.v_my_batches) = 0 as no_batches,
       (select count(*) from public.entitlements) = 0 as no_entitlements;
do $$ begin insert into public.item_stats (item_id, attempts, correct) values ('FL-475-0001', 1, 1); raise exception 'rls should block';
  exception when insufficient_privilege then raise notice 'item_stats insert blocked (%)', sqlstate; end $$;
do $$ begin insert into public.progress (user_id, item_id, attempts, correct, client_updated_at) values ('11111111-1111-4111-8111-111111111111','FL-475-0001',1,1,now()); raise exception 'rls should block';
  exception when insufficient_privilege then raise notice 'foreign progress insert blocked (%)', sqlstate; end $$;
do $$ begin perform public.fn_record_answers('11111111-1111-4111-8111-111111111111', '[]'::jsonb); raise exception 'owner check should block';
  exception when insufficient_privilege then raise notice 'fn_record_answers owner check blocked (%)', sqlstate; end $$;
do $$ begin perform public.fn_alias_items('22222222-2222-4222-8222-222222222222', array['FL-475-0001']); raise exception 'service-only should block';
  exception when insufficient_privilege then raise notice 'fn_alias_items service-only blocked (%)', sqlstate; end $$;

\echo [11] server-owned columns survive client edits (profiles.current_session_id, devices.removed_at)
select pg_temp.as_service();
select session_id is not null as relogged_in from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ios', 'phone');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
update public.profiles set home_jurisdiction = 'FL', sharing_notice_ack = true, current_session_id = null
where id = '11111111-1111-4111-8111-111111111111';
select home_jurisdiction = 'FL' as home_set, sharing_notice_ack, sharing_notice_ack_at is not null as ack_at,
       current_session_id is not null as session_kept
from public.profiles where id = '11111111-1111-4111-8111-111111111111';
update public.devices set name = 'renamed', removed_at = now() where fingerprint_hash = repeat('a',64);
select name = 'renamed' as renamed, removed_at is null as still_active from public.devices where fingerprint_hash = repeat('a',64);

\echo [12] study session lww; anomaly flag dedupe + email outbox; resolve
insert into public.study_sessions (id, user_id, kind, jurisdiction, bank, form_id, position, answers, client_updated_at)
values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','mock','FL','state_FL','short', 3, '[]', '2026-09-08T10:00:00Z');
update public.study_sessions set position = 1, client_updated_at = '2026-09-08T09:00:00Z' where id = '33333333-3333-4333-8333-333333333333';
select position = 3 as stale_update_dropped from public.study_sessions where id = '33333333-3333-4333-8333-333333333333';
update public.study_sessions set position = 7, client_updated_at = '2026-09-08T10:30:00Z' where id = '33333333-3333-4333-8333-333333333333';
select position = 7 as newer_update_applied, public.fn_mock_forms_started('11111111-1111-4111-8111-111111111111') as mocks_1
from public.study_sessions where id = '33333333-3333-4333-8333-333333333333';
select pg_temp.as_service();
select public.fn_open_anomaly_flag('11111111-1111-4111-8111-111111111111','devices_30d','{"distinct_fingerprints":4}') is not null as flagged;
select public.fn_open_anomaly_flag('11111111-1111-4111-8111-111111111111','devices_30d','{"distinct_fingerprints":5}') is null as deduped;
select count(*) = 1 as one_email from public.email_outbox;
select public.fn_distinct_fingerprints_30d('11111111-1111-4111-8111-111111111111') as fps_3;
insert into public.geo_events (user_id, region_key, source) values
  ('11111111-1111-4111-8111-111111111111','US-FL','t'),
  ('11111111-1111-4111-8111-111111111111','GH','t'),
  ('11111111-1111-4111-8111-111111111111','unknown','t');
select public.fn_distinct_regions_24h('11111111-1111-4111-8111-111111111111') = 2 as two_regions;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select public.fn_resolve_anomaly_flags('11111111-1111-4111-8111-111111111111') = 1 as resolved;
select last_reverified_at is not null as reverified from public.profiles where id = '11111111-1111-4111-8111-111111111111';

\echo [13] revenuecat transfer + email lookup (service only)
select pg_temp.as_service();
select public.fn_transfer_entitlements('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','paddle') = 1 as moved;
select public.fn_user_id_by_email('BOB@example.com') = '22222222-2222-4222-8222-222222222222' as by_email;
select action, count(*) from public.audit_log group by 1 order by 1;
select item_id, attempts, correct, p_value, review_flag from public.v_item_pvalues order by 1;

\echo [14] V2: device fingerprint rule — 3 accounts in 30 days flags + exhausts the device
reset role;
insert into auth.users (id, email) values ('44444444-4444-4444-8444-444444444444', 'carol@example.com');
select pg_temp.as_service();
select account_count = 1 as one_account, exhausted = false as not_exhausted, flagged = false as not_flagged
from public.fn_touch_device_fingerprint(repeat('d',64), '11111111-1111-4111-8111-111111111111', 'android', 'Pixel 8');
select account_count = 2 as two_accounts, exhausted = false as still_ok
from public.fn_touch_device_fingerprint(repeat('d',64), '22222222-2222-4222-8222-222222222222', 'android', null);
select account_count = 3 as three_accounts, exhausted as exhausted_now, flagged as flagged_now
from public.fn_touch_device_fingerprint(repeat('d',64), '44444444-4444-4444-8444-444444444444', 'android', null);
-- same account again: idempotent, no new flag
select account_count = 3 as still_three, flagged = false as no_dup_flag
from public.fn_touch_device_fingerprint(repeat('d',64), '44444444-4444-4444-8444-444444444444', 'android', null);
select count(*) = 1 as one_device_accounts_flag from public.anomaly_flags where kind = 'device_accounts';
select exhausted as device_exhausted, account_count = 3 as fp_accounts from public.fn_device_free_tier(repeat('d',64), 'FL');
select count(*) = 3 as device_seen_events from public.events where kind = 'device_seen' and device_hash = repeat('d',64);

\echo [15] V2: free tier usage counted per user and per device, max of both
select public.fn_bump_free_tier_usage('11111111-1111-4111-8111-111111111111', repeat('e',64), 'FL', 30, 1);
select questions_used = 30 as dev_q_30, mocks_used = 1 as dev_m_1, exhausted = false as dev_ok from public.fn_device_free_tier(repeat('e',64), 'FL');
select questions_used >= 30 as user_q_30 from public.fn_user_free_tier('11111111-1111-4111-8111-111111111111', 'FL');
select questions_used = 0 as bob_fresh from public.fn_user_free_tier('22222222-2222-4222-8222-222222222222', 'FL');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select count(*) = 1 as sees_own_usage_only from public.free_tier_usage;

\echo [16] V2: coupons — gift grants complete once; percent codes are recorded; bad codes refused
-- fixture state here: bob holds `complete` (transferred from alice in [13]); alice and carol hold nothing.
select pg_temp.as_service();
insert into public.coupons (code, kind, value, product, max_uses, note) values
  ('GIFT-AAAA-BBBB', 'gift', 0, 'complete', 2, 'smoke'),
  ('PCT2-AAAA-BBBB', 'percent', 25, 'complete', 1, 'smoke'),
  ('DEAD-AAAA-BBBB', 'gift', 0, 'complete', 1, 'smoke');
update public.coupons set disabled_at = now() where code = 'DEAD-AAAA-BBBB';
select ok as gift_ok, kind = 'gift' as gift_kind from public.fn_redeem_coupon('44444444-4444-4444-8444-444444444444', 'gift aaaa bbbb');
select public.fn_has_entitlement('44444444-4444-4444-8444-444444444444', 'complete') as carol_now_complete;
select source = 'coupon' as coupon_source from public.entitlements where user_id = '44444444-4444-4444-8444-444444444444' and product = 'complete' and revoked_at is null limit 1;
select ok = false as dup_refused, error = 'already_redeemed' as dup_reason from public.fn_redeem_coupon('44444444-4444-4444-8444-444444444444', 'GIFT-AAAA-BBBB');
select ok = false as entitled_refused, error = 'already_entitled' as entitled_reason from public.fn_redeem_coupon('22222222-2222-4222-8222-222222222222', 'GIFT-AAAA-BBBB');
select ok as pct_ok, value = 25 as pct_value from public.fn_redeem_coupon('11111111-1111-4111-8111-111111111111', 'PCT2-AAAA-BBBB');
select ok = false as exhausted_refused, error = 'coupon_exhausted' as exhausted_reason from public.fn_redeem_coupon('44444444-4444-4444-8444-444444444444', 'PCT2-AAAA-BBBB');
select ok = false as disabled_refused, error = 'coupon_disabled' as disabled_reason from public.fn_redeem_coupon('44444444-4444-4444-8444-444444444444', 'DEAD-AAAA-BBBB');
select ok = false as unknown_refused, error = 'invalid_code' as unknown_reason from public.fn_redeem_coupon('44444444-4444-4444-8444-444444444444', 'NOPE-NOPE-NOPE');
select count(*) = 2 as coupon_events from public.events where kind = 'coupon_redeemed';
select uses = 1 as gift_uses_1 from public.coupons where code = 'GIFT-AAAA-BBBB';

\echo [17] V2: entitlement pause; study_state lww merge; answers resolve item ids; finished mock is frozen
select public.fn_pause_entitlement('22222222-2222-4222-8222-222222222222', 'complete', now() + interval '1 day') = 1 as paused;
select public.fn_has_entitlement('22222222-2222-4222-8222-222222222222', 'complete') = false as paused_not_live;
select public.fn_pause_entitlement('22222222-2222-4222-8222-222222222222', 'complete', null) = 1 as resumed;
select public.fn_has_entitlement('22222222-2222-4222-8222-222222222222', 'complete') as live_again;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select (settings->>'theme') = 'dark' as put_1 from public.fn_study_state_put('11111111-1111-4111-8111-111111111111', '{"theme":"dark","exam_date":"2026-12-01"}', null, false, '2026-09-09T10:00:00Z');
select (settings->>'theme') = 'dark' and (settings->>'exam_date') = '2026-12-01' and (settings->>'home') = 'FL' as merged
from public.fn_study_state_put('11111111-1111-4111-8111-111111111111', '{"home":"FL"}', '{"daily":30}', false, '2026-09-09T10:05:00Z');
select (settings->>'home') = 'FL' as stale_dropped from public.fn_study_state_put('11111111-1111-4111-8111-111111111111', '{"home":"TX"}', null, false, '2026-09-09T09:00:00Z');
select (plan->>'daily') = '30' as plan_kept from public.study_state where user_id = '11111111-1111-4111-8111-111111111111';
-- answers: the client writes public ids (it cannot read item_id_aliases); the trigger resolves the real item id
select pg_temp.as_service();
select a.public_id as alias_pid from public.item_id_aliases a where a.user_id = '11111111-1111-4111-8111-111111111111' order by a.item_id limit 1 \gset
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into public.answers (user_id, public_id, session_id, chosen, correct, ms)
values ('11111111-1111-4111-8111-111111111111', :'alias_pid', '33333333-3333-4333-8333-333333333333', 'B', true, 9000);
select item_id is not null as item_resolved from public.answers where user_id = '11111111-1111-4111-8111-111111111111' and public_id = :'alias_pid';
insert into public.answers (user_id, public_id, correct) values ('11111111-1111-4111-8111-111111111111', 'not-an-alias', false);
select count(*) filter (where item_id is null) = 1 as unknown_alias_kept_null from public.answers where user_id = '11111111-1111-4111-8111-111111111111';
-- widened study_sessions: status derives from finished_at; a finished mock is frozen for the client
update public.study_sessions set finished_at = now(), score = 0.8, client_updated_at = now() where id = '33333333-3333-4333-8333-333333333333';
select status = 'finished' as status_derived, ended_at is not null as ended_synced from public.study_sessions where id = '33333333-3333-4333-8333-333333333333';
update public.study_sessions set score = 1.0, status = 'active', client_updated_at = now() + interval '1 second' where id = '33333333-3333-4333-8333-333333333333';
select score = 0.8 as score_frozen, status = 'finished' as status_frozen from public.study_sessions where id = '33333333-3333-4333-8333-333333333333';
-- progress round-trips streak / history
select pg_temp.as_service();
select status from public.fn_record_answers('11111111-1111-4111-8111-111111111111', (
  select jsonb_build_array(jsonb_build_object('public_id', a.public_id, 'attempts', 6, 'correct', 2, 'last_answered_at', now(), 'box', 'red',
         'due_at', now(), 'client_updated_at', now() + interval '1 minute', 'streak', 0, 'history', '[{"at":1,"correct":false}]'::jsonb))
  from public.item_id_aliases a where a.user_id = '11111111-1111-4111-8111-111111111111' and a.item_id = 'NAT-PV-I-0001'));
select streak = 0 and jsonb_array_length(history) = 1 as srs_fields_stored from public.progress where user_id = '11111111-1111-4111-8111-111111111111' and item_id = 'NAT-PV-I-0001';
select count(*) >= 1 as cards_visible from (select pg_temp.as_user('11111111-1111-4111-8111-111111111111')) x, public.fn_my_srs_cards();

\echo [18] V2: support + reviews rls; admin functions refuse non-admins and answer admins
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into public.support_tickets (id, user_id, subject, category) values ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'help', 'billing');
insert into public.support_messages (ticket_id, author, author_id, body) values ('55555555-5555-4555-8555-555555555555', 'user', '11111111-1111-4111-8111-111111111111', 'hi');
do $$ begin
  insert into public.support_messages (ticket_id, author, author_id, body) values ('55555555-5555-4555-8555-555555555555', 'admin', '11111111-1111-4111-8111-111111111111', 'fake admin');
  raise exception 'user could post as admin';
exception when insufficient_privilege or check_violation then raise notice 'ok: user cannot post as admin'; end $$;
insert into public.reviews (user_id, rating, body, jurisdiction, display_name) values ('11111111-1111-4111-8111-111111111111', 5, 'great', 'FL', 'Alice');
select pg_temp.as_service();
insert into public.support_messages (ticket_id, author, author_id, body) values ('55555555-5555-4555-8555-555555555555', 'admin', null, 'answer');
select status = 'answered' as ticket_answered from public.support_tickets where id = '55555555-5555-4555-8555-555555555555';
update public.reviews set status = 'approved' where user_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
update public.reviews set body = 'edited' where user_id = '11111111-1111-4111-8111-111111111111';
select status = 'pending' as edit_resets_to_pending from public.reviews where user_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select count(*) = 0 as bob_sees_no_tickets from public.support_tickets;
select count(*) = 0 as bob_sees_no_events_of_alice from public.events where user_id = '11111111-1111-4111-8111-111111111111';
do $$ begin perform public.fn_admin_kpis('7d'); raise exception 'non-admin ran kpis';
exception when insufficient_privilege then raise notice 'ok: kpis refused for non-admin'; end $$;
do $$ begin perform public.fn_admin_user('11111111-1111-4111-8111-111111111111'); raise exception 'non-admin ran fn_admin_user';
exception when insufficient_privilege then raise notice 'ok: fn_admin_user refused for non-admin'; end $$;
-- make bob an admin and try again as bob
select pg_temp.as_service();
select public.fn_make_admin('bob@example.com') = '22222222-2222-4222-8222-222222222222' as bob_admin;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select public.fn_is_admin() as is_admin_now;
select (k->>'signups')::int = 3 as kpi_signups, jsonb_typeof(k->'series') = 'array' as kpi_series, jsonb_typeof(k->'purchases') = 'array' as kpi_purchases,
       (k->>'reviews_pending')::int = 1 as kpi_reviews_pending, (k->>'tickets_open')::int = 0 as kpi_tickets_open
from public.fn_admin_kpis('all') k;
select (u->'profile'->>'id') = '11111111-1111-4111-8111-111111111111' as admin_user_profile,
       jsonb_array_length(u->'events') >= 1 as admin_user_events,
       jsonb_array_length(u->'device_fingerprints') = 1 as admin_user_fps,
       (u->'study'->>'answers')::int = 2 as admin_user_answers
from public.fn_admin_user('11111111-1111-4111-8111-111111111111') u;
select count(*) = 1 as search_by_email, bool_and(email = 'alice@example.com') as search_hit from public.fn_admin_search_users('alice', 10, 0);
select count(*) = 3 as search_all from public.fn_admin_search_users(null, 10, 0);
select count(*) = 1 as flagged_devices from public.fn_admin_flagged_devices(10);
select count(*) >= 1 as admin_reads_all_tickets from public.support_tickets;
select count(*) >= 1 as admin_reads_all_events from public.events where user_id = '11111111-1111-4111-8111-111111111111';
select count(*) = 0 as public_reviews_hidden_when_pending from public.v_public_reviews;
select pg_temp.as_service();
insert into public.content_versions (version, item_count, banks) values ('2026.09.09-1', 16, '{"national_pearsonvue": 12}');
set role anon;
select count(*) = 1 as anon_sees_content_version from public.content_versions;
select count(*) = 0 as anon_sees_no_alerts from public.content_alerts;
reset role;

\echo [19] 0016: app_settings drives the device ceiling; sessions follow it
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select public.fn_max_active_devices() = 1 as default_ceiling_is_one;
do $$ begin perform public.fn_set_app_setting('device_policy', '{"max_active_devices": 3}');
  raise exception 'non-admin wrote a setting';
exception when insufficient_privilege then raise notice 'ok: settings refused for non-admin'; end $$;

-- bob is an admin from [18]; he may change the rule
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.fn_set_app_setting('device_policy', '{"max_active_devices": 3}')).value ->> 'max_active_devices' = '3' as admin_set_ceiling;
select public.fn_max_active_devices() = 3 as ceiling_now_three;

-- with room for three, three devices coexist and all keep live sessions
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select superseded = 0 as carol_first_device from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('1',64), 'ios', 'phone');
select superseded = 0 as carol_second_device from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('2',64), 'web', 'laptop');
select superseded = 0 as carol_third_device from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('3',64), 'android', 'tablet');
select public.fn_active_device_count('44444444-4444-4444-8444-444444444444') = 3 as three_slots_held;
select count(*) = 3 as three_live_sessions from public.sessions where user_id = '44444444-4444-4444-8444-444444444444' and revoked_at is null;
-- and every one of them still authenticates, which is the point of raising the ceiling
select bool_and(public.fn_session_is_valid('44444444-4444-4444-8444-444444444444', s.id, s.device_id)) as all_three_valid
from public.sessions s where s.user_id = '44444444-4444-4444-8444-444444444444' and s.revoked_at is null;

-- the fourth pushes out the least recently seen, not all of them
select superseded = 1 as fourth_retires_exactly_one from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('4',64), 'web', 'desktop');
select public.fn_active_device_count('44444444-4444-4444-8444-444444444444') = 3 as still_three_slots;
select removed_at is not null as oldest_device_retired from public.devices where user_id = '44444444-4444-4444-8444-444444444444' and fingerprint_hash = repeat('1',64);

-- back to one: the next sign-in takes the whole account over again (the 0015 rule)
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.fn_set_app_setting('device_policy', '{"max_active_devices": 1}')).value ->> 'max_active_devices' = '1' as admin_reset_ceiling;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select superseded = 3 as single_device_takes_over_all from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('5',64), 'ios', 'phone2');
select public.fn_active_device_count('44444444-4444-4444-8444-444444444444') = 1 as one_slot_left;
select count(*) = 1 as one_live_session from public.sessions where user_id = '44444444-4444-4444-8444-444444444444' and revoked_at is null;

\echo [20] 0016: impersonation gets a session without displacing the user
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
do $$ begin perform public.fn_start_shadow_session('44444444-4444-4444-8444-444444444444');
  raise exception 'user minted a shadow session';
exception when insufficient_privilege then raise notice 'ok: shadow session is service-role only'; end $$;
select pg_temp.as_service();
select session_id is not null as shadow_session_made from public.fn_start_shadow_session('44444444-4444-4444-8444-444444444444');
-- the user's own device kept its slot and its session
select public.fn_active_device_count('44444444-4444-4444-8444-444444444444') = 1 as user_device_untouched;
select count(*) = 2 as user_session_survives from public.sessions where user_id = '44444444-4444-4444-8444-444444444444' and revoked_at is null;

\echo [21] 0016: refunds are decisions, and approving one revokes access
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
do $$ begin perform public.fn_admin_refunds(null, 10); raise exception 'non-admin listed refunds';
exception when insufficient_privilege then raise notice 'ok: refunds refused for non-admin'; end $$;

select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
-- bob holds `complete` (transferred in [13]); give him the guarantee so a claim can be judged
select pg_temp.as_service();
select public.fn_grant_entitlement('22222222-2222-4222-8222-222222222222', 'pass_guarantee', 'manual', 'smoke-guarantee') is not null as guarantee_granted;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (g->>'has_guarantee')::boolean as claim_has_guarantee,
       (g->>'within_window')::boolean as claim_in_window,
       (g->>'meets_mock_requirement')::boolean = false as claim_needs_more_mocks,
       (g->>'already_refunded')::boolean = false as claim_not_yet_refunded
from public.fn_guarantee_eligibility('22222222-2222-4222-8222-222222222222') g;

do $$ begin perform public.fn_admin_refund_create('22222222-2222-4222-8222-222222222222', 'partial', '{}', null, 'app_store');
  raise exception 'partial refund accepted without an amount';
exception when invalid_parameter_value then raise notice 'ok: partial refund requires an amount'; end $$;

\set rid '00000000-0000-4000-8000-0000000000f1'
select id is not null as refund_filed, status = 'open' as refund_opens_open
from public.fn_admin_refund_create('22222222-2222-4222-8222-222222222222', 'guarantee',
  '{complete,pass_guarantee}'::public.product_kind[], 7900, 'app_store', 'failed the state portion',
  '{"score_report":"https://example.test/report.pdf"}'::jsonb);

-- paying before a decision is refused
do $$
declare v_id uuid;
begin
  select id into v_id from public.refund_requests order by created_at desc limit 1;
  perform public.fn_admin_refund_mark_paid(v_id, 'APPLE-123');
  raise exception 'paid an undecided refund';
exception when invalid_parameter_value then raise notice 'ok: cannot pay before approving'; end $$;

do $$
declare v_id uuid; v_row public.refund_requests;
begin
  select id into v_id from public.refund_requests order by created_at desc limit 1;
  v_row := public.fn_admin_refund_decide(v_id, true, 'score report checked', 7900);
  if v_row.status <> 'approved' then raise exception 'decide did not approve'; end if;
  -- deciding twice is refused
  begin
    perform public.fn_admin_refund_decide(v_id, false, 'oops');
    raise exception 'decided the same refund twice';
  exception when invalid_parameter_value then raise notice 'ok: a refund is decided once'; end;
  v_row := public.fn_admin_refund_mark_paid(v_id, ' APPLE-123 ');
  if v_row.external_refund_id <> 'APPLE-123' then raise exception 'refund reference not trimmed'; end if;
end $$;

-- approval revoked both products, so access is gone and the reason reads 'refund'
select public.fn_has_entitlement('22222222-2222-4222-8222-222222222222', 'complete') = false as complete_revoked_by_refund,
       public.fn_has_entitlement('22222222-2222-4222-8222-222222222222', 'pass_guarantee') = false as guarantee_revoked_by_refund;
select count(*) >= 2 as revoke_reason_is_refund from public.entitlements
where user_id = '22222222-2222-4222-8222-222222222222' and revoke_reason = 'refund';
select (t->>'paid')::int = 1 as one_paid_refund, (t->>'paid_cents')::int = 7900 as paid_total_recorded, (t->>'open')::int = 0 as nothing_left_open
from public.fn_admin_refund_totals() t;
select (g->>'already_refunded')::boolean as claim_now_marked_refunded
from public.fn_guarantee_eligibility('22222222-2222-4222-8222-222222222222') g;
select count(*) = 1 as refund_listed from public.fn_admin_refunds('paid', 10);
select count(*) = 1 as refund_visible_to_owner from (select pg_temp.as_user('22222222-2222-4222-8222-222222222222')) x, public.refund_requests;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select count(*) = 0 as refund_hidden_from_others from public.refund_requests;
reset role;

\echo [22] 0016: content epoch bump reaches clients through v_app_runtime
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select content_epoch = 1 as epoch_starts_at_one from public.v_app_runtime;
do $$ begin perform public.fn_bump_content_epoch(); raise exception 'non-admin bumped the content epoch';
exception when insufficient_privilege then raise notice 'ok: content epoch bump is admin-only'; end $$;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.fn_bump_content_epoch() ->> 'epoch')::int = 2 as epoch_bumped;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select content_epoch = 2 as learner_sees_new_epoch, content_synced_at is not null as sync_time_recorded from public.v_app_runtime;
reset role;

\echo [23] 0017: an impersonated session is actually usable, and works for a user with no device
-- The bug this pins down: fn_session_is_valid required profiles.current_session_id to be the
-- session whenever the ceiling is 1. A shadow session never moves that pointer, so [20] created a
-- row that was valid-looking and rejected on every request. Asserting the row exists is not enough.
-- dave signs up here: inserting into auth.users needs the owner role, not a switched-in one
insert into auth.users (id, email) values ('55555555-5555-4555-8555-555555555555', 'dave@example.com');

select pg_temp.as_service();
-- fn_set_app_setting returns the row; a composite "is not null" needs every column non-null, and
-- updated_by is null for the service role, so assert the effective ceiling instead.
select public.fn_set_app_setting('device_policy', '{"max_active_devices": 1}'::jsonb) is distinct from null as setting_written;
select public.fn_max_active_devices() = 1 as one_device_again;

-- carol has a real device from [19]; the shadow must attach to it and validate
\set csid '00000000-0000-0000-0000-000000000000'
create temp table shadow_carol as
  select * from public.fn_start_shadow_session('44444444-4444-4444-8444-444444444444');
select minted_device = false as reused_carols_real_device,
       expires_at > now() as shadow_expires_later
from shadow_carol;
select public.fn_session_is_valid('44444444-4444-4444-8444-444444444444', session_id, device_id) as shadow_session_is_usable
from shadow_carol;
select public.fn_active_device_count('44444444-4444-4444-8444-444444444444') = 1 as carol_slot_untouched;

-- carol signing in on her phone must not knock the admin's shadow session offline
select count(*) = 1 as shadow_survives_user_login
from public.sessions where user_id = '44444444-4444-4444-8444-444444444444' and is_shadow and revoked_at is null;
select session_id is not null as carol_relogin
from public.fn_register_device('44444444-4444-4444-8444-444444444444', repeat('5',64), 'ios', 'phone2');
select public.fn_session_is_valid('44444444-4444-4444-8444-444444444444', session_id, device_id) as shadow_still_usable_after_login
from shadow_carol;

-- dave signed up and never opened the app: impersonation must still work
select public.fn_active_device_count('55555555-5555-4555-8555-555555555555') = 0 as dave_has_no_device;
create temp table shadow_dave as
  select * from public.fn_start_shadow_session('55555555-5555-4555-8555-555555555555');
select minted_device as dave_device_minted from shadow_dave;
select public.fn_session_is_valid('55555555-5555-4555-8555-555555555555', session_id, device_id) as dave_shadow_usable
from shadow_dave;
-- the minted device is invisible to the slot accounting and to dave's own device screen
select public.fn_active_device_count('55555555-5555-4555-8555-555555555555') = 0 as shadow_device_takes_no_slot;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select count(*) = 0 as shadow_device_hidden_from_owner from public.v_my_devices;
select pg_temp.as_service();

-- dave's first real sign-in must not be displaced by the shadow device, and vice versa
select superseded = 0 as shadow_does_not_retire_real_device
from public.fn_register_device('55555555-5555-4555-8555-555555555555', repeat('7',64), 'ios', 'dave-phone');
select public.fn_active_device_count('55555555-5555-4555-8555-555555555555') = 1 as dave_now_has_one_slot;

-- a second "open as user" replaces the first rather than stacking
select session_id is not null as second_open_as_user
from public.fn_start_shadow_session('55555555-5555-4555-8555-555555555555');
select count(*) = 1 as only_one_live_shadow
from public.sessions where user_id = '55555555-5555-4555-8555-555555555555' and is_shadow and revoked_at is null;

-- pressing Stop revokes it server-side
select public.fn_end_shadow_session('55555555-5555-4555-8555-555555555555') >= 1 as stop_revoked_shadow;
select count(*) = 0 as no_live_shadow_after_stop
from public.sessions where user_id = '55555555-5555-4555-8555-555555555555' and is_shadow and revoked_at is null;
do $$ begin perform public.fn_end_shadow_session('55555555-5555-4555-8555-555555555555');
exception when insufficient_privilege then raise exception 'service role could not end a shadow session'; end $$;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
do $$ begin perform public.fn_end_shadow_session('55555555-5555-4555-8555-555555555555');
  raise exception 'user ended a shadow session';
exception when insufficient_privilege then raise notice 'ok: ending a shadow session is service-role only'; end $$;
reset role;

-- an expired shadow session stops validating on its own
select pg_temp.as_service();
create temp table shadow_exp as
  select * from public.fn_start_shadow_session('55555555-5555-4555-8555-555555555555');
update public.sessions set expires_at = now() - interval '1 minute'
where id = (select session_id from shadow_exp);
select public.fn_session_is_valid('55555555-5555-4555-8555-555555555555', session_id, device_id) = false as expired_shadow_rejected
from shadow_exp;
reset role;

\echo [24] 0018: a shadow device does not make an empty account look like it has one
-- erin has never opened the app; impersonating her must not change her device count.
-- auth.users needs the owner role, so insert before switching into service/user roles.
insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'erin@example.com') on conflict do nothing;
select pg_temp.as_service();
select session_id is not null as erin_shadow from public.fn_start_shadow_session('66666666-6666-4666-8666-666666666666');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select devices = 0 as console_reports_no_devices
from public.fn_admin_search_users('erin@example.com', 10, 0);
select (public.fn_admin_user('66666666-6666-4666-8666-666666666666') ->> 'active_devices')::int = 0 as detail_active_devices_zero,
       (public.fn_admin_user('66666666-6666-4666-8666-666666666666') ->> 'shadow_sessions')::int = 1 as detail_shows_live_shadow,
       jsonb_array_length(public.fn_admin_user('66666666-6666-4666-8666-666666666666') -> 'devices') = 1 as detail_still_lists_shadow_row;

\echo [25] 0020: a free account cannot change home_jurisdiction after the first write
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
update public.profiles set home_jurisdiction = 'CO' where id = '66666666-6666-4666-8666-666666666666';
select home_jurisdiction = 'CO' as erin_home_set from public.profiles where id = '66666666-6666-4666-8666-666666666666';
update public.profiles set home_jurisdiction = 'TX' where id = '66666666-6666-4666-8666-666666666666';
select home_jurisdiction = 'CO' as erin_home_stays from public.profiles where id = '66666666-6666-4666-8666-666666666666';
reset role;
