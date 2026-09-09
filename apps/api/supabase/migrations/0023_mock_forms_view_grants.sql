-- 0023_mock_forms_view_grants.sql
-- v_mock_forms (0021) inherited the schema's default privileges (ALL to anon/authenticated) and is
-- auto-updatable, so a client could have written mock_forms through it. Read-only, as intended.
revoke all on public.v_mock_forms from public, anon, authenticated;
grant select on public.v_mock_forms to anon, authenticated;
-- belt and braces: no default write path even if the view definition changes later
alter view public.v_mock_forms set (security_barrier = true);
