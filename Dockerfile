FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY packages/vault-core/package.json packages/vault-core/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY packages/vault-core/package.json packages/vault-core/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/indexer/dist apps/indexer/dist
COPY --from=build /app/packages/vault-core/dist packages/vault-core/dist
EXPOSE 3333
CMD ["npm", "run", "start"]
