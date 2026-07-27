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

RUN mkdir -p /app/backups && chown -R node:node /app

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app/node_modules

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prompts ./prompts

USER node
EXPOSE 3141
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3141)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
