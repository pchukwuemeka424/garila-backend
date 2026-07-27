# garila-backend

GARIL AI API server (Fastify + MongoDB). Endpoints: `/api/*`, `/ws`.

## Quick start

```bash
cp .env.example .env
# fill OPENROUTER_API_KEY, AUTH_SECRET, MONGODB_URI
npm ci
npm run build
npm start
```

Dev: `npm run dev` (port `3141` by default).

## Docker

```bash
docker build -t garila-backend .
docker run --rm -p 3141:3141 --env-file .env garila-backend
```

## Coolify / Nixpacks

- Port: `3141`
- Health check: `/api/health`
- Nixpacks: `nixpacks.toml`
- Or use the root `Dockerfile`
