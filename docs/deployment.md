# Deployment

For a start-to-finish private-alpha self-host walkthrough, read
[Self-Host Vault MCP](self-host.md) first. This page is the lower-level runtime,
environment, and platform reference.

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

For a self-hosted OAuth flow on the connector itself, set the OAuth issuer and authorization server to the public service URL and use an HMAC signing secret plus a private authorization password:

```bash
PUBLIC_BASE_URL=https://vault-mcp.example.com
OAUTH_ISSUER=https://vault-mcp.example.com
OAUTH_AUDIENCE=https://vault-mcp.example.com/mcp
OAUTH_AUTHORIZATION_SERVER=https://vault-mcp.example.com
OAUTH_JWT_SECRET=long-random-jwt-secret
OAUTH_AUTH_PASSWORD=private-human-authorization-password
OAUTH_SCOPES=vault:read
```

This enables:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-authorization-server/mcp`
- `POST /oauth/register` for dynamic client registration
- `GET/POST /oauth/authorize` for password-gated authorization-code + PKCE
- `POST /oauth/token` for authorization-code and refresh-token grants

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

For setup after Vercel CLI login or after creating a Vercel token, use the bootstrap script:

```bash
# Optional for unattended runs. Omit if `vercel whoami` already works locally.
export VERCEL_TOKEN="..."
export VERCEL_TEAM_ID="team_mhftpUYWIR5oysxTjLnSLCol"
export VERCEL_PROJECT_NAME="vault-mcp-connector"
export DEPLOY_AUTH_MODE="oauth"
export PUBLIC_BASE_URL="https://vault-mcp.example.com"
export DATABASE_URL="postgres://user:password@host:5432/vault_mcp"
export MCP_SYNC_TOKEN="long-random-sync-token"
export ALLOWED_ORIGINS="https://chatgpt.com,https://claude.ai,https://chat.openai.com"
export OAUTH_ISSUER="https://auth.example.com"
export OAUTH_AUDIENCE="https://vault-mcp.example.com/mcp"
export OAUTH_AUTHORIZATION_SERVER="https://auth.example.com"
export OAUTH_JWKS_URL="https://auth.example.com/.well-known/jwks.json"
export OAUTH_SCOPES="vault:read"

npm run deploy:vercel:check
npm run deploy:vercel
```

The script links the local repo to the Vercel project, adds or updates production environment variables, pulls production settings, and runs `vercel deploy --prod`. Add `-- --smoke` or set `RUN_REMOTE_SMOKE=1` when `SMOKE_ACCESS_TOKEN` or temporary `MCP_ACCESS_TOKEN` is available. If `VERCEL_TOKEN` is unset, it uses the authenticated local Vercel CLI session.

For a temporary private deployment before the OAuth provider is ready, use static-token mode:

```bash
export DEPLOY_AUTH_MODE="static"
export VERCEL_TOKEN="..."
export VERCEL_TEAM_ID="team_mhftpUYWIR5oysxTjLnSLCol"
export VERCEL_PROJECT_NAME="vault-mcp-connector"
export PUBLIC_BASE_URL="https://vault-mcp.example.com"
export DATABASE_URL="postgres://user:password@host:5432/vault_mcp"
export MCP_SYNC_TOKEN="long-random-sync-token"
export MCP_ACCESS_TOKEN="temporary-test-access-token"
export ALLOWED_ORIGINS="https://chatgpt.com,https://claude.ai,https://chat.openai.com"

npm run deploy:vercel:check
npm run deploy:vercel -- --smoke
```

Static-token mode is for MCP Inspector and remote smoke testing only. Switch back to `DEPLOY_AUTH_MODE=oauth` before ChatGPT/Claude production acceptance.

Self-hosted OAuth mode uses the same deploy script with `OAUTH_JWT_SECRET` and `OAUTH_AUTH_PASSWORD` instead of `OAUTH_JWKS_URL`:

```bash
export DEPLOY_AUTH_MODE="oauth"
export PUBLIC_BASE_URL="https://vault-mcp.example.com"
export OAUTH_ISSUER="$PUBLIC_BASE_URL"
export OAUTH_AUDIENCE="$PUBLIC_BASE_URL/mcp"
export OAUTH_AUTHORIZATION_SERVER="$PUBLIC_BASE_URL"
export OAUTH_JWT_SECRET="long-random-jwt-secret"
export OAUTH_AUTH_PASSWORD="private-human-authorization-password"
export OAUTH_SCOPES="vault:read"
```

## Build

```bash
npm ci
npm run build
npm run start
```

## Health And Observability

`GET /healthz` is the first operator check after deploy and after sync. It returns
safe runtime status without exposing secrets or database URLs:

- `ok`
- `service.name`
- `service.version`
- `service.public_base_url`
- `service.mcp_resource_url`
- `document_count`
- `vault_count`
- `generated_at`
- `last_sync_at`
- `storage.kind`
- `storage.ok`
- `storage.migrations` for Postgres

When storage is healthy, the endpoint returns HTTP `200`. When Postgres is
unreachable or the schema cannot be queried, the endpoint returns HTTP `503` with
`ok: false` and a safe `storage.error` string.

## Container Hosts

Use the Dockerfile for hosts that run containers directly, such as Fly.io, Render, Railway, a VPS, or any Kubernetes-like runtime:

Container build:

```bash
docker build -t vault-mcp-connector .
docker run --rm -p 3333:3333 --env-file .env vault-mcp-connector
```

Docker was not available in the current local verification environment.

## Postgres

When `DATABASE_URL` is set, Vault MCP uses Postgres for derived vault index data,
OAuth client state, token replay protection, sync manifests, and write proposals.

Run migrations before the first deploy and before upgrades:

```bash
DATABASE_URL="postgres://user:password@host:5432/vault_mcp" npm run db:migrate
```

The command builds the server package, runs all pending migrations, and prints a
JSON summary:

```json
{
  "ok": true,
  "total_migrations": 1,
  "applied_count": 1,
  "applied": [
    {
      "id": "0001_initial_vault_mcp_schema",
      "description": "Create the initial Vault MCP tables, indexes, and multi-vault columns."
    }
  ],
  "already_applied": [],
  "pending": []
}
```

The server also runs the same migration runner during startup as a safety net,
but self-hosters should treat `npm run db:migrate` as the explicit deploy/upgrade
step. Applied migrations are tracked in `vault_mcp_schema_migrations`.

The current schema includes:

- `vault_documents`
- `vault_index_meta`
- `vault_sync_manifests`
- `oauth_clients`
- `oauth_token_uses`
- `write_proposals`
- GIN full-text index on a generated `tsvector`
- supporting indexes for paths, vault scoping, token expiry, and write proposal status

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
npm run smoke:postgres:fresh
```

`smoke:postgres:fresh` creates a temporary schema inside the configured database,
runs migrations from an empty state, syncs one fixture document, verifies
`/healthz`-equivalent store health, and drops the schema. It is the safest way to
prove fresh database boot without touching existing Vault MCP tables.

```bash
POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp_smoke" \
npm run smoke:postgres
```

The smoke test starts the server with `DATABASE_URL` set from `POSTGRES_SMOKE_DATABASE_URL`, runs the same migration runner, syncs `/Users/tjt/Documents/Tristan's Personal vault copy`, and verifies `tools/list`, `search`, `fetch`, and guessed-ID denial through Postgres full-text search.

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

For the self-hosted OAuth flow, verify dynamic client registration, PKCE authorization-code exchange, refresh tokens, and the MCP remote smoke in one pass:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_OAUTH_PASSWORD="$OAUTH_AUTH_PASSWORD" \
MCP_SYNC_TOKEN="$MCP_SYNC_TOKEN" \
npm run smoke:oauth-flow
```

## OAuth Protected Resource Metadata

The server exposes:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

Unauthenticated MCP requests return `401` with `WWW-Authenticate: Bearer resource_metadata="..."`.

The app can run in either of two OAuth modes:

- external provider mode: validate tokens from `OAUTH_JWKS_URL`
- self-hosted mode: issue and validate HMAC-signed access tokens with `OAUTH_JWT_SECRET`, dynamic client registration, single-use PKCE authorization codes, and rotating refresh tokens

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
