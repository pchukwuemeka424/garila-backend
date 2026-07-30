#!/usr/bin/env bash
# Build backend only (API). Run from monorepo root.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> Installing backend dependencies"
(
	cd backend
	if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
)

echo "==> Compiling backend"
npx tsc -p backend/tsconfig.json
test -f backend/dist/index.js
mkdir -p backend/backups

echo "==> Backend build OK → backend/dist"
echo "    Start: cd backend && node dist/index.js"
echo "    Or:    pm2 start deploy/backend/ecosystem.config.cjs"
echo "    Or:    sudo systemctl start garil-backend"
