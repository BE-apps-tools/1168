#!/usr/bin/env bash
# Thin wrapper around brandcheck.py (Blattner data-vis artifact self-check).
# Usage: BLATTNER_LOGO=/path/to/Blattner_B_Burst_B_-_White.svg scripts/brandcheck.sh index.html
set -e
F="$1"
py "$(dirname "$0")/brandcheck.py" "$F" "$BLATTNER_LOGO"
