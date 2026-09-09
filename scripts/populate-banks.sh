#!/usr/bin/env bash
# Breadth-first population of every question bank using the free LLM router (no paid API spend).
#
# Each pass asks for up to PER_NODE items per blueprint node per bank, then promotes the ones that
# pass the local gate (citation.quoted_text verbatim in the cached statute + zero lint errors) into
# content/items as provisional `verified`. Passes repeat, so the banks fill breadth-first: every
# state gets something before any state gets everything — which is what shipping needs.
#
#   PER_NODE=6 PASSES=50 nohup scripts/populate-banks.sh &
#   tail -f .pipeline/populate.log
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export LLM_BACKEND=router
export LLM_CONCURRENCY="${LLM_CONCURRENCY:-4}"
PER_NODE="${PER_NODE:-6}"
PASSES="${PASSES:-50}"
LOG="${LOG:-.pipeline/populate.log}"
mkdir -p "$(dirname "$LOG")"

banks=()
for f in content/states/*.yaml; do banks+=("state_$(basename "$f" .yaml)"); done
banks+=("national_pearsonvue" "national_psi")

say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }
count() { find "content/items/$1" -name '*.yaml' 2>/dev/null | wc -l | tr -d ' '; }
total() { find content/items -name '*.yaml' 2>/dev/null | wc -l | tr -d ' '; }

say "=== populate start: ${#banks[@]} banks · PER_NODE=$PER_NODE · concurrency=$LLM_CONCURRENCY · total now $(total) ==="
for pass in $(seq 1 "$PASSES"); do
  say "--- pass $pass/$PASSES (total $(total)) ---"
  for b in "${banks[@]}"; do
    before=$(count "$b")
    pnpm -s --filter @rep/pipeline cli draft "$b" --limit "$PER_NODE" >>"$LOG" 2>&1 || say "  ! draft failed $b"
    pnpm -s --filter @rep/pipeline cli verify-local "$b" >>"$LOG" 2>&1 || say "  ! verify failed $b"
    after=$(count "$b")
    say "  $b  $before -> $after  (+$((after - before)))"
  done
done
say "=== populate done: total $(total) ==="
