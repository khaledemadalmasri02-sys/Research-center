FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml* ./
COPY scripts/ ./scripts/
COPY lib/ ./lib/
COPY artifacts/research-data/ ./artifacts/research-data/

RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Build environment variables
ENV VITE_API_URL=/api

FROM nginx:alpine AS runtime

WORKDIR /app

COPY --from=builder /app/artifacts/research-data/dist/public /usr/share/nginx/html
COPY --from=builder /app/artifacts/research-data/dist/public assets

# Configure nginx
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3003/ || exit 1

CMD ["nginx", "-g", "daemon off;"]