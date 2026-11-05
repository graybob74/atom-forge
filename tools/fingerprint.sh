#!/bin/bash
# All setups' fingerprints in four parallel lanes, sorted: tools/fingerprint.sh > out.txt
cd "$(dirname "$0")/.." && node tools/fingerprint.js --list | xargs -n 4 -P 4 node tools/fingerprint.js | sort
