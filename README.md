# Vault MCP Connector

Private, read-only MCP connector for selected Obsidian vault context.

## Wiki

A plain-English project wiki is hosted from `public/wiki/index.html` and is intended
for readers with no coding background. In production it is available at:

```text
https://vault-mcp-connector.vercel.app/wiki/
```

The wiki explains the mental model, request flow, repository map, source-policy
boundary, and file-by-file walkthroughs for the hand-authored project code.

V1 exposes an allowlisted derived index through:

- `POST /mcp` - MCP Streamable HTTP JSON-RPC endpoint.
- `GET /mcp` - authenticated Streamable HTTP SSE endpoint.
- `GET /healthz` - service and index health.
- `POST /admin/sync` - authenticated sync endpoint for the local indexer.
- `GET /notes/:id` - authenticated private citation URL for fetched note chunks.
- `GET /.well-known/oauth-protected-resource` - OAuth protected-resource metadata for MCP clients.

## Local Development

Use the snapshot vault for indexing and tests:

```bash
cp .env.example .env
npm install
npm run build

MCP_ACCESS_TOKEN=dev-access-token \
MCP_SYNC_TOKEN=dev-sync-token \
npm run dev:server
```

In another terminal:

```bash
MCP_SYNC_TOKEN=dev-sync-token npm run index -- \
  --vault "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-name "Tristan's Personal vault copy" \
  --public-base-url "http://127.0.0.1:3333" \
  --server "http://127.0.0.1:3333"
```

Then check:

```bash
curl http://127.0.0.1:3333/healthz
```

Or run the compiled local smoke test:

```bash
npm run smoke:local
npm run smoke:oauth-local
```

For a deployed endpoint:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_ACCESS_TOKEN="test-or-oauth-access-token" \
MCP_SYNC_TOKEN="sync-token" \
npm run smoke:remote
```

## Storage

Local development uses `INDEX_FILE` JSON storage when `DATABASE_URL` is unset. Production can set `DATABASE_URL` to use Postgres:

```bash
DATABASE_URL=postgres://user:password@host:5432/vault_mcp
```

The Postgres store creates:

- `vault_documents` with generated `tsvector` full-text search.
- `vault_index_meta` for sync metadata and stats.

Sync is a full replacement transaction, so deleted notes disappear from the remote index after the next successful sync.

## Auth

Local development can use `MCP_ACCESS_TOKEN`. Production can use OAuth JWT validation:

```bash
OAUTH_ISSUER=https://auth.example.com
OAUTH_AUDIENCE=https://vault-mcp.example.com/mcp
OAUTH_AUTHORIZATION_SERVER=https://auth.example.com
OAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json
OAUTH_SCOPES=vault:read
```

Unauthenticated MCP requests return `401` with a `WWW-Authenticate` header pointing to protected-resource metadata.

`ALLOWED_ORIGINS` controls CORS/preflight and origin protection for deployed clients.

## Source Policy

V1 allowlist:

- active `20 Projects/**/Project Home.md` files
- `00 System/Task Hub.md`
- selected technical/reference subfolders under `40 Reference/`

V1 denylist wins before allowlist:

- `00 System/Credentials/`
- `00 System/Needs Review.md`
- `02 Daily/`
- `50 Areas/Finance/`
- `50 Areas/Identity/`
- `90 Archive/`
- notes tagged as sensitive, credentials, finance, legal, identity, or review-gated
- Excalidraw Markdown wrappers
- unselected `40 Reference/` subfolders, including prompt archives, business-development references, client process notes, and other review-sensitive material

The MCP server never reads the vault directly. It only serves the synced, allowlisted index.

## Deployment

See [docs/deployment.md](docs/deployment.md).
