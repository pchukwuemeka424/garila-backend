# garila-backend

GARIL AI API server (Fastify + MongoDB). Endpoints: `/api/*`, `/ws`.

## Quick start

```bash
cp .env.example .env
# fill OPENROUTER_API_KEY, AUTH_SECRET, MONGODB_URI
npm ci
npx tsc -p tsconfig.json
npm start
```

Dev: `npm run dev` (port `3141`).

## VPS (Debian/Ubuntu)

```bash
sudo bash setup-vps.sh /var/www/garila-backend
# edit /var/www/garila-backend/.env
# replace API_DOMAIN in /etc/nginx/sites-available/garil-backend
sudo systemctl start garil-backend
sudo certbot --nginx -d api.your.domain
curl -s http://127.0.0.1:3141/api/health
```

## Docker / Coolify

```bash
docker build -t garila-backend .
docker run --rm -p 3141:3141 --env-file .env garila-backend
```

- Port: `3141`
- Health: `/api/health`
- Nixpacks: `nixpacks.toml`

## PM2

```bash
npm ci && npx tsc -p tsconfig.json
pm2 start ecosystem.config.cjs
```
