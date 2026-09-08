-- private bucket for per-batch item json (SPEC §5.4). only the service role writes; clients read via
-- short-lived signed urls issued by issue-batch. no public access, no direct client reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('batches', 'batches', false, 5242880, array['application/json'])
on conflict (id) do nothing;

-- content assets (audio, free sample) are served from a second private bucket through signed urls.
insert into storage.buckets (id, name, public, file_size_limit)
values ('content', 'content', false, 52428800)
on conflict (id) do nothing;

-- no storage.objects policies for authenticated/anon: absence of a policy = no access under RLS.
-- the service role bypasses RLS and is the only writer/reader (signed urls are minted server-side).
