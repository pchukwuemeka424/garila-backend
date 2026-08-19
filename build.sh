#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
npx tsc -p tsconfig.json
test -f dist/index.js
mkdir -p backups
echo "Backend build OK → dist/"
