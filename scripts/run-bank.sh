#!/usr/bin/env bash
# One-command content run for a bank: draft → wait/collect → verify → wait/collect-verify → QA packets.
#   scripts/run-bank.sh national_pearsonvue [--limit 8] [--nodes I,II]
# Reads ANTHROPIC_API_KEY from the environment or ~/.zshrc; ignores the Claude Code proxy base URL.
set -euo pipefail
cd "$(dirname "$0")/.."
BANK="${1:?bank required, e.g. national_pearsonvue}"; shift || true
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY=$(grep '^export ANTHROPIC_API_KEY=' ~/.zshrc | head -1 | sed -e 's/^export ANTHROPIC_API_KEY=//' -e "s/^[\"']//" -e "s/[\"']$//")
  export ANTHROPIC_API_KEY
fi
unset ANTHROPIC_BASE_URL
run() { pnpm --silent --filter @rep/pipeline run cli -- "$@"; }
BACKEND="${LLM_BACKEND:-$(grep '^LLM_BACKEND=' .env 2>/dev/null | cut -d= -f2)}"; BACKEND="${BACKEND:-router}"
echo "== backend: $BACKEND"
echo "== draft $BANK $*"
if [ "$BACKEND" = "anthropic" ]; then
  OUT=$(run draft "$BANK" "$@" | tee /dev/stderr)
  DRAFT_ID=$(echo "$OUT" | grep -o 'msgbatch_[A-Za-z0-9]*' | head -1); [ -n "$DRAFT_ID" ] || { echo "no batch id"; exit 1; }
  echo "== wait $DRAFT_ID"; run wait "$DRAFT_ID"
  echo "== verify $BANK"
  OUT=$(run verify "$BANK" | tee /dev/stderr)
  VERIFY_ID=$(echo "$OUT" | grep -o 'msgbatch_[A-Za-z0-9]*' | head -1)
  if [ -n "$VERIFY_ID" ]; then echo "== wait $VERIFY_ID"; run wait "$VERIFY_ID"; fi
else
  run draft "$BANK" "$@"          # free-tier router: drafts are written immediately
  echo "== verify $BANK"
  run verify "$BANK"
  # a second verify pass picks up drafts whose verifier calls failed on rate limits
  if [ -n "$(ls .pipeline/drafts/$BANK 2>/dev/null)" ]; then echo "== verify (retry) $BANK"; run verify "$BANK"; fi
  echo "== balance + keys $BANK"
  run balance "$BANK"             # key must not be the unique longest option
  run keys "$BANK"                # uniform key positions per domain
fi
echo "== qa packets"; run qa-packet "$BANK"
run status --md docs/STATUS.md >/dev/null
echo "done. Rejected drafts (with reasons): .pipeline/rejected/$BANK/  Packets: .pipeline/qa-packets/$BANK/index.md"
