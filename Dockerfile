FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.json \
	&& test -f dist/index.js

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3141

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /app/backups \
	&& chown -R node:node /app

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app/node_modules

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prompts ./prompts

USER node
EXPOSE 3141
# Coolify expects curl/wget in the image for Dockerfile healthchecks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
	CMD curl -fsS "http://127.0.0.1:${PORT:-3141}/api/health" || exit 1

CMD ["node", "dist/index.js"]
