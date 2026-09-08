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
\echo [2] SPEC 5.3: three devices register, the fourth raises P0003 device_limit
select device_id is not null as ok, created from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ios', 'phone');
select created from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('b',64), 'android', 'tablet');
select created from public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('c',64), 'web', 'laptop');
do $$ begin
  perform public.fn_register_device('11111111-1111-4111-8111-111111111111', repeat('d',64), 'web', 'fourth');
  raise exception 'expected device_limit';
exception when sqlstate 'P0003' then raise notice 'device_limit raised as expected'; end $$;

\echo [3] SPEC 5.3: single live session
select count(*) filter (where revoked_at is null) = 1 as one_live, count(*) = 3 as three_total
from public.sessions where user_id = '11111111-1111-4111-8111-111111111111';
select p.current_session_id = s.id as profile_points_at_live
from public.profiles p join public.sessions s on s.user_id = p.id and s.revoked_at is null
where p.id = '11111111-1111-4111-8111-111111111111';
select public.fn_session_is_valid('11111111-1111-4111-8111-111111111111', p.current_session_id, s.device_id) as valid
from public.profiles p join public.sessions s on s.id = p.current_session_id
where p.id = '11111111-1111-4111-8111-111111111111';

\echo [4] SPEC 5.3: removal -> 7-day cooldown, slot still counted
select public.fn_remove_device('11111111-1111-4111-8111-111111111111', d.id) > now() + interval '6 days' as cooldown_7d
from public.devices d where d.fingerprint_hash = repeat('c',64);
select public.fn_active_device_count('11111111-1111-4111-8111-111111111111') as still_three;
select public.fn_can_register_device('11111111-1111-4111-8111-111111111111', repeat('d',64)) as new_fp_false;
select public.fn_can_register_device('11111111-1111-4111-8111-111111111111', repeat('a',64)) as same_fp_true;

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
