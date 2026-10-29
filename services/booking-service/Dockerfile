# syntax=docker/dockerfile:1.7
# Stages : deps (dépendances prod), test (lint + tests), runtime (image finale)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS test
WORKDIR /app
ENV NODE_ENV=test
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts
COPY . .
RUN npm run lint && npm test

FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="riviera-booking" \
      org.opencontainers.image.description="RivieraBoats - service de réservation (réservations, paiement simulé)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/owner/riviera-boats"

ENV NODE_ENV=production \
    PORT=3001

# npm/yarn inutiles à l'exécution
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# utilisateur node
USER 1000
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
