#!/usr/bin/env bash
# run the migrations + seed + scripts/pg-smoke.sql on a throwaway vanilla postgres cluster.
# needs a local postgres install (initdb / pg_ctl / psql on PATH or in PGBIN); no docker, no
# supabase cli. this is a cheap correctness check for the sql; `supabase db reset` is the real thing.
#
#   pnpm db:smoke            # or: bash scripts/pg-smoke.sh
#   PGBIN=/opt/homebrew/opt/postgresql@16/bin bash scripts/pg-smoke.sh
set -euo pipefail
export LANG=C LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api="$(cd "$here/.." && pwd)"
PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for cand in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/bin /usr/lib/postgresql/*/bin /usr/local/bin; do
    if [ -x "$cand/initdb" ]; then PGBIN="$cand"; break; fi
  done
fi
[ -n "$PGBIN" ] && [ -x "$PGBIN/initdb" ] || { echo "postgres binaries not found; set PGBIN"; exit 2; }

port="${PGPORT_SMOKE:-54339}"
work="$(mktemp -d -t rep-pg-smoke)"
cleanup() { "$PGBIN/pg_ctl" -D "$work/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$work/data" -U postgres --auth=trust -E UTF8 --locale=C >"$work/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$work/data" -o "-p $port -k /tmp -c listen_addresses=127.0.0.1" -l "$work/pg.log" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres
"$PGBIN/createdb" rep_smoke

run() { "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -d rep_smoke -f "$1"; }
echo "shim";        run "$here/pg-shim.sql"
for f in "$api"/supabase/migrations/*.sql; do echo "migration $(basename "$f")"; run "$f"; done
echo "seed";        run "$api/supabase/seed.sql"
echo "smoke";       "$PGBIN/psql" -v ON_ERROR_STOP=1 -d rep_smoke -f "$here/pg-smoke.sql" 2>&1 \
  | sed -E 's#^psql:.*pg-smoke.sql:[0-9]+: ##' | grep -v -E '^\s*$|^\(1 row\)$|^ as_(service|user) $|^-+$'
echo "ok: migrations, seed and smoke test passed on $("$PGBIN/postgres" --version)"
