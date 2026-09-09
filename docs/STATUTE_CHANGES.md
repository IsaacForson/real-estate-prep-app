# Statute changes

Appended by `pnpm pipeline watch-sources` (nightly via `.github/workflows/content-nightly.yml`)
whenever a cached authority's live source no longer hashes the same as the last check. Newest at
the bottom. Each entry lists the source URL, the sections whose text differs, and the items pulled
to `status: needs_review` (with the reason in each item's `review_reason`).

How to act on an entry (docs/CONTENT_PIPELINE.md §7):

1. Read the new text under `content/statutes/<JUR>/_versions/<slug>/<date>.md` next to the cached
   doc. The cached doc is left untouched because it is what the live items were verified against.
2. If the change is real, re-ingest the authority (`pnpm pipeline ingest …`), then re-verify or
   retire each listed item; clear `review_reason` and set the status back when re-approved.
3. If the change is noise (a re-flowed page, a new footer), re-approve the items and note it below.

The same facts go to the `content_alerts` table for the admin console via `pipeline publish --remote`.

