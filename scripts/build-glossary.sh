#!/usr/bin/env bash
# Define every term the item banks reference, verified against the cached statute text, using the
# free LLM router. Terms come from each item's `terms` field, so this only ever covers vocabulary
# the questions actually exercise.
#
#   nohup scripts/build-glossary.sh & ; tail -f .pipeline/glossary.log
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export LLM_BACKEND=router
LOG="${LOG:-.pipeline/glossary.log}"
mkdir -p "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }

banks=$(python3 - <<'PY'
import glob, re, collections
per=collections.defaultdict(set)
for f in glob.glob("content/items/**/*.yaml", recursive=True):
    s=open(f,encoding='utf-8',errors='replace').read()
    bank=(re.search(r'^bank: (.+)$', s, re.M) or [None,''])[1].strip()
    m=re.search(r'^terms:\n((?:  - .*\n)+)', s, re.M)
    if not m or not bank: continue
    for line in m.group(1).strip().split("\n"):
        t=line.strip()[2:].strip().strip('"').strip("'")
        if t: per[bank].add(t.lower())
# biggest banks first: the national ones are shared by every state
for b,_ in sorted(per.items(), key=lambda x:-len(x[1])): print(b)
PY
)

say "=== glossary build start ==="
for b in $banks; do
  # each pass takes the next slice of undefined terms; repeat until the bank reports none left
  for pass in $(seq 1 40); do
    out=$(pnpm -s --filter @rep/pipeline cli glossary "$b" --limit 24 2>&1 | tail -8)
    printf '%s\n' "$out" >>"$LOG"
    echo "$out" | grep -q "terms: 0" && { say "$b done"; break; }
    echo "$out" | grep -q "0 new terms" && { say "$b done"; break; }
  done
done
say "=== glossary build done ==="
