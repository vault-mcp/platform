# Vault MCP Connector

Vault MCP Connector connects Obsidian to ChatGPT, Claude, Codex, and other MCP clients.
The Obsidian plugin controls what is indexed, starts an optional local MCP
server, and provides one explicit access-level selector for local reads and
direct writes. Hosted deployments serve only the derived index approved by the
plugin and can queue reviewable vault-write proposals.

## Install And Start

Vault MCP Connector is currently a public alpha release candidate. Until its Obsidian
Community Plugins review is complete, install release `0.2.1` with BRAT or place
the release assets `manifest.json`, `main.js`, and `styles.css` in
`<vault>/.obsidian/plugins/vault-mcp-connector/`.

1. Enable Vault MCP Connector under **Settings > Community plugins**.
2. Open **Settings > Vault MCP Connector** for setup and advanced configuration.
3. For local-only use, leave the server URL alone, choose a local file access
   level, and turn on **Run local MCP server**. No external Node installation is
   required.
4. Copy the local client connection JSON from settings into a local-capable MCP
   client.
5. For ChatGPT or another hosted client, follow the hosted deployment and OAuth
   setup shown in the plugin.

The right sidebar is the operational view after setup: access, server state,
ChatGPT bridge state, index status, sync, proposals, and recent activity.

## Security And Privacy Disclosures

- **Network use:** Hosted mode connects to the configured Vault MCP server. The
  default public server URL is `https://vault-mcp-connector.vercel.app`. Local
  mode binds to `127.0.0.1` and does not require the hosted service.
- **Data sent remotely:** Remote sync sends only Markdown content and metadata
  approved by the plugin's indexing policy. Local filesystem tools operate on
  the user's computer; hosted local access sends individual authenticated tool
  requests through the opt-in desktop bridge rather than uploading a background
  file inventory.
- **External file access:** Local access is Off by default. Scoped modes enforce
  configured folders. GOD mode grants direct read/write access across the local
  filesystem and enables create, overwrite, exact edit, directory create, copy,
  move/rename, and delete. Direct writes do not create a proposal or wait for an
  additional Obsidian approval.
- **Credentials:** MCP and sync tokens are stored in Obsidian's plugin data for
  the vault. Treat copied connection bundles as secrets.
- **Accounts:** Hosted setup can require accounts with the user's chosen hosting,
  database, and MCP client providers. Local-only mode does not require those
  accounts.
- **Telemetry and ads:** Vault MCP includes no telemetry, analytics, advertising,
  or paid feature tracking.

## MCP Tools

The server always exposes these read-only MCP tools:

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

Hosted proposal tools are disabled by default. When the server owner sets
`MCP_WRITE_PROPOSALS_ENABLED=true` and the authenticated OAuth token includes
`vault:write`, the server also exposes:

- `propose_vault_write` - queue a create, append, replace, frontmatter, or rename proposal for Obsidian-side review.
- `list_write_proposals` - inspect proposal status and audit history.

`propose_vault_write` never edits a vault directly. Existing-note operations
require the current `metadata.content_hash` from `fetch` or
`fetch_note_by_path`; stale hashes, non-indexed existing notes, unsafe paths,
and invalid operation payloads are refused before a proposal is stored. The
Obsidian plugin still performs its own live-file hash check, diff review,
backup, audit, approval, and local apply. Denied or non-indexed paths remain
unavailable for hosted reads even if a client guesses an id or exact path.

The local desktop/developer server can additionally expose `local_fs_policy`,
`local_fs_audit`, `local_list_files`, `local_read_file`,
`local_read_files`, `local_read_file_bytes`, `local_file_info`, and selected write tools such as `local_write_file`,
`local_write_file_bytes`, `local_edit_file`, `local_create_directory`,
`local_copy_path`, `local_move_path`, and `local_delete_path`. Read modes can also expose
`local_find_files` and `local_search_text` for on-demand local discovery
without building an index.
These tools are off by default and are intended for explicit user-directed
local interactions, not automatic vault enumeration. The plugin launcher can
time-box enabled filesystem access with a session expiry window; once expired,
the local MCP surface falls back to `local_fs_policy` and `local_fs_audit` until
the server is restarted or refreshed. The audit tool reads the local JSONL audit
trail for successful write-side operations, newest first. The Obsidian plugin
includes a `Refresh session` action for intentionally renewing that local
access window while working with a local MCP client. By default, every local
filesystem tool call except `local_fs_policy` must also include the exact policy
phrase as `user_intent` (`use local filesystem` unless the plugin setting
changes it), so clients have to make the current local-file interaction explicit
in the tool arguments.

Hosted desktop access is a separate opt-in bridge. When the deployment owner
sets `MCP_REMOTE_LOCAL_FS_ENABLED=true`, the OAuth token includes
`local:access`, and the matching Obsidian installation enables
`Allow hosted ChatGPT to use local tools`, the hosted MCP also exposes:

- `desktop_local_fs_status` - report the live plugin/sidecar policy, heartbeat, and exact active local-tool argument schemas.
- `desktop_run_local_tool` - enqueue one short-lived local tool call and wait for the matching Obsidian installation to execute it.
- `desktop_local_request_status` - check a request that outlived the synchronous wait window.

The plugin polls outward to the hosted server, then forwards each claimed call
to the localhost MCP endpoint. The hosted service never opens an inbound port
on the user's computer, never receives a background filesystem inventory, and
cannot bypass the local sidecar's roots, operation toggles, expiry, exact
`user_intent`, symlink checks, delete confirmation, or audit trail. The plugin
uses one access-level control for local clients and the hosted bridge: Off,
scoped Read, scoped Read/write, or GOD read/write. Scoped writes save files
immediately inside the configured roots and operation allowlist. GOD mode
removes root limits and enables every direct write operation. Neither direct
mode creates a hosted write proposal or waits for Obsidian approval.

Hosted bridge enablement is session-only. It always returns to Off when
Obsidian reloads, restarts, or reopens, so each new interactive chat session
must be armed explicitly from the plugin.

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

V1 exposes an allowlisted derived index through:

- `POST /mcp` - MCP Streamable HTTP JSON-RPC endpoint.
- `GET /mcp` - authenticated Streamable HTTP SSE endpoint.
- `GET /healthz` - service version, storage/database status, migration ids, vault count, and index health.
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

## Demo Vault

Public docs and screenshots should use the synthetic demo vault under
`fixtures/vault/`, not a copied personal vault. It includes allowlisted project
and reference notes, denied credential/daily-note examples, and one intentional
fixture secret used to prove redaction behavior.

Verify it before using it in public-facing material:

```bash
npm run demo:verify
```

See [docs/demo-vault.md](docs/demo-vault.md).

In another terminal:

```bash
MCP_SYNC_TOKEN=dev-sync-token npm run index -- \
  --vault "/path/to/disposable-test-vault" \
  --vault-name "Disposable test vault" \
  --public-base-url "http://127.0.0.1:3333" \
  --server "http://127.0.0.1:3333"
```

Then check:

```bash
curl http://127.0.0.1:3333/healthz
```

Or run the wiki-free local release gate:

```bash
npm run release:check:local
```

That command runs build, API check, tests, MCP UI smoke, local filesystem MCP
smoke including session-expiry behavior, local MCP Inspector-origin smoke, audit, plugin
package/verify/BRAT/fresh-install/lifecycle checks, clean-env local smoke, and
OAuth local smoke. It does not regenerate the wiki, run production smokes, or
replace real MCP client acceptance.

To prepare the Obsidian plugin for BRAT private-alpha testing:

```bash
npm run plugin:brat:prepare
npm run plugin:brat:verify
npm run plugin:brat:verify-github
npm run plugin:brat:check-copy -- --check-github-release
npm run plugin:brat:verify-copy-install
npm run plugin:brat:prepare-ui-evidence
npm run plugin:brat:evidence-status
npm run plugin:brat:verify-ui-evidence
```

Upload `dist/brat/vault-mcp-connector/manifest.json`, `dist/brat/vault-mcp-connector/main.js`, and
`dist/brat/vault-mcp-connector/styles.css` to the GitHub release whose tag exactly matches
the plugin manifest version. The Community Plugins candidate is release `0.2.1`.
Use [docs/brat-private-alpha-walkthrough.md](docs/brat-private-alpha-walkthrough.md)
for the screenshot-backed BRAT UI evidence gate.

For a smaller manual subset:

```bash
npm run smoke:mcp-ui
npm run smoke:local-fs
npm run smoke:local-inspector
npm run smoke:local
npm run smoke:oauth-local
```

`smoke:mcp-ui` is dependency-free and does not contact ChatGPT. It executes the
MCP Apps output template with a tiny fake DOM, then verifies delayed
`openai:set_globals`, retry rendering, note Markdown, status cards, error cards,
and proposal cards.

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

Private-alpha proposal writes require both gates:

```bash
MCP_WRITE_PROPOSALS_ENABLED=true
OAUTH_SCOPES="vault:read vault:write"
```

Existing OAuth clients must reauthorize before their token can carry the new
scope. Leaving either gate off keeps the hosted MCP surface read-only. Static
owner tokens receive the proposal tools only when
`MCP_WRITE_PROPOSALS_ENABLED=true`.

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

Start with [docs/self-host.md](docs/self-host.md) for the private-alpha
self-host path. Use [docs/deployment.md](docs/deployment.md) for lower-level
runtime and platform details.

For the planned no-cloud desktop path, see
[docs/local-server-mode.md](docs/local-server-mode.md). That mode will let the
Obsidian plugin start a localhost MCP server while the vault is open. The standard
three-file Obsidian package compiles the local server directly into `main.js`, so
packaged installs run it in Obsidian's desktop Node context without an external
Node/npm command. Developer installs can still configure the platform repo
folder and Node/npm command as a fallback. The plugin waits for `/healthz` and requires the
local service name, version, storage status, and MCP endpoint to match before it
marks the embedded server ready. The configured local port is treated as preferred; the
plugin can reuse a compatible existing local server or scan upward to the next
available port before spawning. The plugin can also copy a local client
connection bundle with the localhost endpoint, bearer auth header, and current
local filesystem policy context; it does not include the plugin/admin sync
token. The adjacent `Copy instructions` action copies a no-token prompt that
tells local-capable chat clients to call `local_fs_policy`, respect the
configured roots/operations/session window, and include `user_intent` when
required. Verify the same profile with
`npm run smoke:local-server`. The explicit local
filesystem MCP policy gate is `npm run smoke:local-fs`; it checks scoped
read/write roots, denied outside paths, destructive confirmation, session
expiry, required `user_intent`, and god-mode absolute-path access in temporary
directories.
`npm run smoke:local-inspector`
checks the MCP Inspector localhost origins, preflight behavior, authenticated
SSE, forbidden-origin rejection, and local filesystem tool calls through an
Inspector-origin request.
