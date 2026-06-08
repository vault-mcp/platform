# Deployment

## Runtime

The server is a Node HTTP service. It can run from `npm run start` after `npm run build`, as a Vercel Express Function through `api/index.ts`, or from the included Dockerfile on a container host.

Required production environment:

```bash
HOST=0.0.0.0
PORT=3333
PUBLIC_BASE_URL=https://vault-mcp.example.com
DATABASE_URL=postgres://user:password@host:5432/vault_mcp
MCP_SYNC_TOKEN=long-random-sync-token
ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai
OAUTH_ISSUER=https://auth.example.com
OAUTH_AUDIENCE=https://vault-mcp.example.com/mcp
OAUTH_AUTHORIZATION_SERVER=https://auth.example.com
OAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json
OAUTH_SCOPES=vault:read
```

`MCP_ACCESS_TOKEN` is for local development and one-off MCP Inspector testing. Production should prefer OAuth JWT validation through `OAUTH_*` variables.

## Vercel

Vercel does not deploy Docker images directly. For Vercel, use the `api/index.ts` Express entrypoint and `vercel.json`; the Express app becomes a single Vercel Function.

Required steps:

```bash
vercel login
vercel link
vercel pull --yes --environment=production
vercel env add PUBLIC_BASE_URL production
vercel env add DATABASE_URL production
vercel env add MCP_SYNC_TOKEN production
vercel env add OAUTH_ISSUER production
vercel env add OAUTH_AUDIENCE production
vercel env add OAUTH_AUTHORIZATION_SERVER production
vercel env add OAUTH_JWKS_URL production
vercel env add OAUTH_SCOPES production
vercel --prod
```

If using temporary static bearer auth for a private test deployment, set `MCP_ACCESS_TOKEN` too. Remove it when OAuth is the only intended production path.

Local `vercel build` requires project settings from `vercel pull`. In an unauthenticated checkout, Vercel CLI returns `project_settings_required`; authenticate and link first.

## Build

```bash
npm ci
npm run build
npm run start
```

## Container Hosts

Use the Dockerfile for hosts that run containers directly, such as Fly.io, Render, Railway, a VPS, or any Kubernetes-like runtime:

Container build:

```bash
docker build -t vault-mcp-connector .
docker run --rm -p 3333:3333 --env-file .env vault-mcp-connector
```

Docker was not available in the current local verification environment.

## Postgres

When `DATABASE_URL` is set, the server creates the required tables and indexes on startup:

- `vault_documents`
- `vault_index_meta`
- GIN full-text index on a generated `tsvector`

The local indexer performs full replacement syncs:

```bash
MCP_SYNC_TOKEN="$MCP_SYNC_TOKEN" npm run index -- \
  --vault "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-name "Tristan's Personal vault copy" \
  --public-base-url "$PUBLIC_BASE_URL" \
  --server "$PUBLIC_BASE_URL"
```

For production syncs from the live vault, change `--vault` only after acceptance testing on the copied vault.

To verify the Postgres storage path before deploying, point the smoke test at a throwaway database. This performs a full replacement sync into `vault_documents`, so do not use a database that contains an index you need to preserve:

```bash
POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp_smoke" \
npm run smoke:postgres
```

The smoke test starts the server with `DATABASE_URL` set from `POSTGRES_SMOKE_DATABASE_URL`, syncs `/Users/tjt/Documents/Tristan's Personal vault copy`, and verifies `tools/list`, `search`, `fetch`, and guessed-ID denial through Postgres full-text search.

## Remote Smoke Test

After deployment and env setup:

```bash
npm run build
SMOKE_BASE_URL="https://vault-mcp.example.com" \
MCP_ACCESS_TOKEN="temporary-test-access-token" \
MCP_SYNC_TOKEN="$MCP_SYNC_TOKEN" \
npm run smoke:remote
```

When using OAuth-only production, set `SMOKE_ACCESS_TOKEN` to an access token issued by the configured OAuth provider:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_ACCESS_TOKEN="oauth-access-token" \
SMOKE_EXPECT_OAUTH=true \
npm run smoke:remote
```

## OAuth Protected Resource Metadata

The server exposes:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

Unauthenticated MCP requests return `401` with `WWW-Authenticate: Bearer resource_metadata="..."`.

The app is a resource server. It validates tokens issued by your OAuth/OIDC provider; it does not issue authorization codes, refresh tokens, or client credentials itself.

## CORS and Origin Protection

`ALLOWED_ORIGINS` controls both DNS-rebinding/origin protection and CORS preflight responses. The server:

- accepts requests with no `Origin` header, which is common for server-side MCP clients
- returns `204` to allowed `OPTIONS` preflight requests
- exposes `WWW-Authenticate` and `Mcp-Session-Id` response headers
- rejects disallowed origins with `403`

Use comma-separated origins:

```bash
ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai,https://chat.openai.com
```
