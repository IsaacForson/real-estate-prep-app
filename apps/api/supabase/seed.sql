-- seed.sql — local development only (applied by `supabase db reset`). never run in production.
--
-- the real item_index is written by the content pipeline's publish step. content/items is empty
-- at the time of writing, so these are placeholder ids that satisfy ITEM_ID_RE
-- (packages/schema/src/item.ts) and map onto real blueprint nodes from
-- content/blueprints/national_pearsonvue.yaml. replace with `pnpm pipeline publish` output.

insert into public.item_index (item_id, bank, jurisdiction, blueprint_node, cognitive_level, status) values
  ('NAT-PV-I-0001',   'national_pearsonvue', 'NAT', 'I.A',   'knowledge',   'published'),
  ('NAT-PV-I-0002',   'national_pearsonvue', 'NAT', 'I.B',   'application', 'published'),
  ('NAT-PV-I-0003',   'national_pearsonvue', 'NAT', 'I.C',   'knowledge',   'published'),
  ('NAT-PV-I-0004',   'national_pearsonvue', 'NAT', 'I.D',   'analysis',    'published'),
  ('NAT-PV-II-0001',  'national_pearsonvue', 'NAT', 'II.A',  'knowledge',   'published'),
  ('NAT-PV-II-0002',  'national_pearsonvue', 'NAT', 'II.B',  'application', 'published'),
  ('NAT-PV-III-0001', 'national_pearsonvue', 'NAT', 'III.A', 'knowledge',   'published'),
  ('NAT-PV-III-0002', 'national_pearsonvue', 'NAT', 'III.C', 'application', 'published'),
  ('NAT-PV-IV-0001',  'national_pearsonvue', 'NAT', 'IV.B',  'knowledge',   'published'),
  ('NAT-PV-IV-0002',  'national_pearsonvue', 'NAT', 'IV.E',  'application', 'published'),
  ('NAT-PV-IV-0003',  'national_pearsonvue', 'NAT', 'IV.G',  'analysis',    'published'),
  ('NAT-PV-VIII-0001','national_pearsonvue', 'NAT', 'VIII.A','application', 'published'),
  ('FL-475-0001',     'state_FL',            'FL',  '1.1',   'knowledge',   'published'),
  ('FL-475-0002',     'state_FL',            'FL',  '1.2',   'application', 'published'),
  ('FL-475-0003',     'state_FL',            'FL',  '2.1',   'knowledge',   'published'),
  ('TX-1101-0001',    'state_TX',            'TX',  '1.1',   'knowledge',   'published')
on conflict (item_id) do nothing;

-- canary variant pool (SPEC §5.4). the text of each variant lives in the content bucket under
-- the same id; here we only know that the id exists and which real item it paraphrases.
insert into public.item_index (item_id, bank, jurisdiction, blueprint_node, cognitive_level, status, is_canary) values
  ('CAN-0123456789abcdef', 'national_pearsonvue', 'NAT', 'I.A',  'knowledge',   'published', true),
  ('CAN-1123456789abcdef', 'national_pearsonvue', 'NAT', 'IV.B', 'knowledge',   'published', true),
  ('CAN-2123456789abcdef', 'national_pearsonvue', 'NAT', 'II.A', 'application', 'published', true),
  ('CAN-3123456789abcdef', 'state_FL',            'FL',  '1.1',  'knowledge',   'published', true)
on conflict (item_id) do nothing;

-- to grant yourself the paid tier locally after signing up in studio:
--   select public.fn_grant_entitlement('<your-user-uuid>', 'complete', 'manual', null, null, '{"note":"local dev"}');
-- (run as postgres / service role in the sql editor.)
