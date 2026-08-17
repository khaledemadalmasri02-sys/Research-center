FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml* ./
COPY scripts/ ./scripts/
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN npm install -g pnpm && pnpm install --frozen-lockfile

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache libc6-compat tini

ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/pnpm-workspace.yaml ./package.json ./

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3004/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-strip-types", "artifacts/api-server/dist/index.js"]