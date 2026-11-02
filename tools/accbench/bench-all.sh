#!/bin/bash
for sc in "water 400" "waterion 300" "salt 300" "combustion 300" "plasma 200" "nif 150" "water4k 120"; do
  set -- $sc
  for v in base js dt2 dt4 rc9 rc12; do
    n=$2; [ $v = dt2 ] && n=$(($2*2)); [ $v = dt4 ] && n=$(($2*4))
    timeout 900 node "$(dirname "$0")/bench-acc.js" $1 $v $n 2>&1 | tail -1
  done
done
