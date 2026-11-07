#!/bin/bash
# Runs every test suite: tools/runtests.js (parallel lanes, the separate files of t_features as jobs of their own, then
# whatever failed again alone). usage: tools/runtests.sh [tag] [lanes]     (from the repository root)
exec node "$(dirname "$0")/runtests.js" "$@"
