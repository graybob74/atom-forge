#!/bin/bash
# Runs every test suite on a snapshot copy of the repository, in two parallel lanes (about 15 minutes).
# usage: tools/runtests.sh [tag]        (from the repository root)
# Two suites are known to fail now and then under the load of both lanes; rerun them alone before believing it:
#   t_chips (the radiation upset check) and t_collider (³⁵⁶Og + ²⁴⁹Cf "nothing listed as made").
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; TAG="${1:-run}"
SNAP="${TMPDIR:-/tmp}/atomforge-snap-$TAG-$$"
rm -rf "$SNAP"; mkdir -p "$SNAP"
cp -r "$REPO/src" "$REPO/tests" "$REPO/build.js" "$SNAP/"
mkdir -p "$SNAP/dist"
cd "$SNAP" && node build.js >/dev/null || { echo "BUILD FAILED"; exit 1; }
OUT="$SNAP/out"; mkdir -p "$OUT"
lane() { # lane name, suites...
  local name="$1"; shift
  for s in "$@"; do
    local t0=$(date +%s)
    node "tests/$s.js" > "$OUT/$s.log" 2>&1; local rc=$?
    printf "%-12s rc=%d  %5ds  %s\n" "$s" "$rc" "$(( $(date +%s) - t0 ))" "$(tail -n 1 "$OUT/$s.log" | cut -c1-110)" >> "$OUT/$name.summary"
  done
}
lane A t_lint t_data t_nuclear t_energy t_physics t_collider t_molecules t_design t_chips t_wasm t_features t_touch &
lane B t_page t_threads t_select t_gl t_hep t_regress t_fuzz t_compat &
wait
cat "$OUT/A.summary" "$OUT/B.summary"
echo "logs in $OUT"
grep -l "rc=[1-9]" "$OUT"/*.summary >/dev/null && echo "SOME SUITES FAILED" || echo "ALL SUITES PASSED"
