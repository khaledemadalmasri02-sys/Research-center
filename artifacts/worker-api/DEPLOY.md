# Deploy to Cloudflare Workers

## Prerequisites

1. [Install Wrangler](https://developers.cloudflare.com/workers/platform/environment-variables/)
2. Log in: `wrangler login`

## Setup

### 1. Create KV Namespace for Sessions
```bash
wrangler kv:namespace create "SESSIONS"
# Copy the ID and update wrangler.jsonc
```

### 2. Create D1 Database
```bash
wrangler d1 database create "mednexus-research"
# Copy the database ID and update wrangler.jsonc
```

### 3. Apply Database Schema
```bash
wrangler d1 execute mednexus-research --sql-file=schema.sql
```

### 4. Set Variables and Secrets

Update `wrangler.jsonc` with your KV and D1 IDs, then set secrets:
```bash
wrangler secret put SESSION_SECRET
# Enter a secure random string
```

## Deploy

```bash
wrangler deploy
```

## Configure DNS

In your Cloudflare dashboard:
1. Go to **Workers** → **Your Worker**
2. Add route: `mednoenix.fit/research/*`
3. Set up DNS if not already configured

## Authentication

Credentials:
- **Username:** `Khaled`
- **Password:** `khaled`

## API Endpoints

- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Check auth status
- `GET /api/health` - Health check

## Update Frontend

Update your frontend to point to the new Worker:
- API base URL: `https://mednexus.fit/research`