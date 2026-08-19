# Backend API — VPS / Coolify

Fastify API only (`/api/*`, `/ws`). No static UI.

## Coolify (separate resource)

### Monorepo (`Garil AI`)

1. New application → this Git repo.
2. **Dockerfile location:** `deploy/backend/Dockerfile`
3. **Ports Exposes:** `3141` (must match `PORT`; default Coolify `3000` causes bad gateway)
4. **Health check:** `/api/health`
5. **Environment** in Coolify UI (required):
   - `OPENROUTER_API_KEY`
   - `AUTH_SECRET`
   - `MONGODB_URI` → Coolify MongoDB URL (**not** `127.0.0.1`)
   - `PORT=3141`

Alternative: Base Directory = `backend` and Build Pack = Nixpacks (`backend/nixpacks.toml`).

### Standalone (`garila-backend`)

1. Repo: https://github.com/pchukwuemeka424/garila-backend
2. **Dockerfile** at repo root
3. **Ports Exposes:** `3141`
4. Health `/api/health`
5. Same env vars as above — create/link a MongoDB resource and paste its connection string into `MONGODB_URI`

## Docker

```bash
# from monorepo root
docker build -f deploy/backend/Dockerfile -t garil-backend .
docker run --rm -p 3141:3141 --env-file backend/.env garil-backend
```

Standalone:

```bash
docker build -t garila-backend .
docker run --rm -p 3141:3141 --env-file .env garila-backend
```

## Manual VPS

### Monorepo

```bash
sudo bash deploy/backend/setup-vps.sh /var/www/garil-ai
# edit /var/www/garil-ai/backend/.env
# edit /etc/nginx/sites-available/garil-backend (API_DOMAIN)
sudo systemctl start garil-backend
sudo certbot --nginx -d api.your.domain
curl -s http://127.0.0.1:3141/api/health
```

### Standalone clone

```bash
git clone https://github.com/pchukwuemeka424/garila-backend.git
cd garila-backend
sudo bash setup-vps.sh /var/www/garila-backend
```

## PM2

```bash
# monorepo
bash deploy/backend/build.sh
pm2 start deploy/backend/ecosystem.config.cjs

# standalone
npm ci && npx tsc -p tsconfig.json
pm2 start ecosystem.config.cjs
```
