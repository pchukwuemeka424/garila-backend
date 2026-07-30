# Build from monorepo root:
#   docker build -f deploy/backend/Dockerfile -t garil-backend .
#
# Coolify: Dockerfile = deploy/backend/Dockerfile, context = repository root.
# Set Ports Exposes = 3141 and MONGODB_URI to your MongoDB resource (not localhost).

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend

COPY backend/ ./backend/
RUN npx tsc -p backend/tsconfig.json \
	&& test -f backend/dist/index.js

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3141

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /app/backend/backups \
	&& chown -R node:node /app

COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend \
	&& chown -R node:node /app/backend/node_modules

COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prompts ./backend/prompts

USER node
EXPOSE 3141
# Coolify expects curl/wget in the image for Dockerfile healthchecks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
	CMD curl -fsS "http://127.0.0.1:${PORT:-3141}/api/health" || exit 1

CMD ["node", "backend/dist/index.js"]
