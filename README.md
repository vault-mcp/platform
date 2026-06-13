# Vault MCP Connector

Private, read-only MCP connector for selected Obsidian vault context.

## MCP Tools

The server currently exposes these read-only MCP tools:

- `search` - compatibility search; defaults to section-level results.
- `search_notes` - search and return one result per indexed note.
- `search_sections` - search heading-level sections and chunks.
- `list_notes` - list indexed/readable notes with optional scope and metadata filters.
- `recent_notes` - list recently updated indexed notes.
- `active_projects` - list active project notes from the allowlisted index.
- `fetch` - fetch an indexed chunk by id returned from search.
- `fetch_note_by_path` - fetch full indexed note content by exact allowlisted vault path.
- `get_index_status` - return safe index counts, policy scopes, and freshness metadata.
- `list_vaults` - list vaults that have synced to the server.
- `get_vault_status` - return sync, policy, and document-count status for one vault.
- `debug_search` - explain query normalization and why a search may return few or no results.

All tools are read-only. Denied or non-indexed paths remain unavailable even if a client guesses an id or exact path.

When exactly one vault is connected, read tools can omit `vault_id`. When more
than one vault is connected, search/list/fetch/status/debug tools return a clear
tool error until the client passes `vault_id`. Use `list_vaults` first to choose
the vault, then pass that id to follow-up reads.

## ChatGPT UI Surface

The MCP tools return both machine-readable `structuredContent` and human-readable
text summaries. Search and list tools include next-action hints such as which id
or path to fetch next, and fetch results include citation URLs plus an explicit
reminder that vault note content is untrusted reference material.

High-value tools also advertise a ChatGPT-compatible output template at
`ui://vault-mcp/results-v2.html` through `_meta.ui.resourceUri` and the compatibility
`openai/outputTemplate` field. Clients that support Apps-style MCP components can
read that `text/html;profile=mcp-app` resource and render search results, note
lists, diagnostics, and fetched notes as compact cards. Clients that do not
support embedded components still get the same structured JSON and readable text
payloads.

## Wiki

A plain-English project wiki is hosted from `public/wiki/index.html` and is intended
for readers with no coding background. In production it is available at:

```text
https://vault-mcp-connector.vercel.app/wiki/
```

The wiki explains the mental model, request flow, repository map, source-policy
boundary, MCP tools, and file-by-file walkthroughs for the hand-authored project code.

V1 exposes an allowlisted derived index through:

- `POST /mcp` - MCP Streamable HTTP JSON-RPC endpoint.
- `GET /mcp` - authenticated Streamable HTTP SSE endpoint.
- `GET /healthz` - service and index health.
- `POST /admin/sync` - authenticated sync endpoint for the local indexer.
- `DELETE /admin/vaults/:vaultId` - authenticated cleanup endpoint for removing a synced vault, its manifest, and its write proposals.
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

To prove multi-vault scoped reads against a deployed endpoint:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_ACCESS_TOKEN="test-or-oauth-access-token" \
MCP_SYNC_TOKEN="sync-token" \
npm run smoke:multi-vault-remote
```

The multi-vault smoke creates a temporary `smoke-multivault` vault, verifies
unscoped read errors plus scoped search/fetch/status behavior, then deletes the
temporary vault.

## Storage

Local development uses `INDEX_FILE` JSON storage when `DATABASE_URL` is unset. Production can set `DATABASE_URL` to use Postgres:

```bash
DATABASE_URL=postgres://user:password@host:5432/vault_mcp
```

Run database migrations before first deploy and before upgrades:

```bash
DATABASE_URL=postgres://user:password@host:5432/vault_mcp npm run db:migrate
```

The server also runs the same migration runner on startup as a safety net. The
migration ledger is stored in `vault_mcp_schema_migrations`.

The Postgres schema includes:

- `vault_documents` with generated `tsvector` full-text search.
- `vault_index_meta` for sync metadata and stats.
- `vault_sync_manifests` for per-vault sync state.
- `oauth_clients` and `oauth_token_uses` for self-hosted OAuth.
- `write_proposals` for proposal-first write workflows.

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
