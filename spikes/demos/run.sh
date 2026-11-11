#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
required_node=$(cat ../../.node-version)
if [[ $(node -v) != "v${required_node}" ]]; then
  printf 'Use Node %s (found %s)\n' "$required_node" "$(node -v)" >&2
  exit 1
fi
npm ci --ignore-scripts
npx playwright install chromium ffmpeg
python3 -m venv .venv
.venv/bin/pip install --disable-pip-version-check numpy==2.5.4
node record.mjs
.venv/bin/python finish.py
