# garila-backend

GARIL AI API server (Fastify + MongoDB). Endpoints: `/api/*`, `/ws`.

## Coolify

1. New application → this repo → Dockerfile (root).
2. **Ports Exposes = `3141`** (must match `PORT`; Coolify default `3000` causes bad gateway).
3. Health path: `/api/health`
4. Environment variables (required):

| Key | Value |
|-----|--------|
| `PORT` | `3141` |
| `OPENROUTER_API_KEY` | your key |
| `AUTH_SECRET` | long random string |
| `MONGODB_URI` | Coolify MongoDB URL — **not** `127.0.0.1` |

Create/link a MongoDB resource in Coolify and paste its connection string into `MONGODB_URI`
(e.g. `mongodb://user:pass@<mongo-host>:27017/feynman?authSource=admin`).

## Docker

```bash
docker build -t garila-backend .
docker run --rm -p 3141:3141 --env-file .env garila-backend
```

## VPS

```bash
sudo bash setup-vps.sh /var/www/garila-backend
```
