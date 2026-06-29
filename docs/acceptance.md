# Acceptance Runbook

Use this after the remote HTTPS endpoint, Postgres, sync token, and OAuth provider are configured.
For first-time setup, start with [Self-Host Vault MCP](self-host.md).

## Automated Gates

Local copied-vault gates:

```bash
npm run release:check:local
```

That wiki-free local release gate runs:

- `npm run build`
- `npm run check:api`
- `npm test`
- `npm run smoke:mcp-ui`
- `npm audit --audit-level=low`
- `npm run plugin:package`
- `npm run plugin:verify-package`
- `npm run plugin:brat:prepare -- --skip-build`
- `npm run plugin:brat:verify`
- `npm run plugin:smoke-fresh-install`
- `npm run plugin:smoke-lifecycle`
- clean-env `npm run smoke:local`
- `npm run smoke:oauth-local`

It intentionally skips wiki generation unless explicitly requested. It also does
not replace the remote OAuth, remote multi-vault, MCP Inspector, ChatGPT, Claude,
Codex, or real BRAT UI acceptance gates.

For focused reruns:

```bash
npm run build
npm run check:api
npm test
npm run smoke:mcp-ui
npm run smoke:local
npm run smoke:oauth-local
```

Run the two server local smoke scripts sequentially unless you set different `PORT` values; both default to `3333`.
`smoke:mcp-ui` does not start a server or use live ChatGPT. It loads the MCP Apps
HTML component from the compiled server package and verifies delayed tool
globals plus rendered search, note, status, error, and proposal card states in a
dependency-free fake DOM.

If a throwaway Postgres database is available, verify the production storage path too:

```bash
POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp_smoke" \
npm run db:migrate

POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp_smoke" \
npm run smoke:postgres:fresh

POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp_smoke" \
npm run smoke:postgres
```

`npm run db:migrate` uses `DATABASE_URL` first and falls back to
`POSTGRES_SMOKE_DATABASE_URL`, so the first command applies the schema to the
throwaway database. `smoke:postgres:fresh` creates a temporary schema, runs
migrations from empty state, syncs a tiny fixture, verifies health, and drops the
schema. The full Postgres smoke command then replaces the `vault_documents` table
contents in that database with the copied-vault test index.

## BRAT

The local BRAT gate proves the GitHub release asset shape:

```bash
npm run plugin:brat:prepare
npm run plugin:brat:verify
```

Passing output must show:

- `ok: true`
- release tag/name equal to the plugin manifest version
- required assets exactly `manifest.json`, `main.js`, and `styles.css`
- copied `main.js` and `styles.css` matching the built plugin files

The GitHub prerelease asset gate proves the assets BRAT will fetch from GitHub:

```bash
npm run plugin:brat:verify-github
```

For the private-alpha `0.1.0` release, this verifies:

- release URL: `https://github.com/vault-mcp/platform/releases/tag/0.1.0`
- tag and release name: `0.1.0`
- release is a prerelease, not a draft
- required assets exactly `manifest.json`, `main.js`, and `styles.css`
- downloaded assets pass the same manifest/runtime verifier
- GitHub asset digests match the downloaded file hashes

The real BRAT gate still requires a GitHub prerelease and copied-vault UI test:

1. Use the existing `0.1.0` prerelease, or create a new prerelease whose tag and release name match the manifest version.
2. If recreating, upload `manifest.json`, `main.js`, and `styles.css` from `dist/brat/vault-mcp/`.
3. Install through BRAT into `/Users/tjt/Documents/Tristan's Personal vault copy`
   or another disposable vault.
4. Enable `Vault MCP`.
5. Import the setup bundle or paste server settings.
6. Run `Check connection`, `Preview index`, and a copied-vault sync.
7. Capture screenshots of the BRAT install, enabled plugin, readiness checklist,
   preview queue, and sync summary.

For a private GitHub repository, BRAT needs a GitHub token with read access to
the selected repository contents. Do not hand private-org access to external
testers unless that is the intended beta boundary.

Remote endpoint gate with temporary static bearer auth:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_ACCESS_TOKEN="temporary-test-access-token" \
MCP_SYNC_TOKEN="sync-token" \
npm run smoke:remote
```

Remote endpoint gate with OAuth:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_ACCESS_TOKEN="oauth-access-token" \
SMOKE_EXPECT_OAUTH=true \
npm run smoke:remote
```

Self-hosted OAuth flow gate:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_OAUTH_PASSWORD="private-human-authorization-password" \
MCP_SYNC_TOKEN="sync-token" \
npm run smoke:oauth-flow
```

This verifies authorization server metadata, dynamic client registration, PKCE authorization-code exchange, single-use authorization codes, refresh-token exchange, refresh-token replay denial, copied-vault sync, and MCP `search`/`fetch`.

Add multi-vault scoped-read verification to that same OAuth gate with:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_OAUTH_PASSWORD="private-human-authorization-password" \
MCP_SYNC_TOKEN="sync-token" \
SMOKE_MULTI_VAULT=true \
npm run smoke:oauth-flow
```

The multi-vault pass creates a temporary `smoke-multivault` vault, verifies unscoped read errors plus scoped search/fetch/status behavior, then deletes the temporary vault.

Passing output must include:

- `ok: true`
- nonzero `document_count`
- `first_result_path: "20 Projects/Vault MCP Connector/Project Home.md"`
- `metadata_resource: "https://vault-mcp.example.com/mcp"`

The smoke script also verifies authenticated `GET /mcp` returns `text/event-stream`.

Also verify preflight/origin behavior:

```bash
curl -i -X OPTIONS "https://vault-mcp.example.com/mcp" \
  -H "Origin: https://chatgpt.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type,Accept"
```

Expected: `204` with `Access-Control-Allow-Origin: https://chatgpt.com`.

## MCP Inspector

1. Start from a synced endpoint.
2. Run:

```bash
npx @modelcontextprotocol/inspector https://vault-mcp.example.com/mcp
```

3. Provide an `Authorization: Bearer ...` header.
4. Confirm `tools/list` returns the read-only tool set: `search`, `search_notes`, `search_sections`, `list_notes`, `recent_notes`, `active_projects`, `fetch`, `fetch_note_by_path`, `get_index_status`, `list_vaults`, `get_vault_status`, and `debug_search`.
5. Call `search` with `Vault MCP Connector`.
6. Call `list_notes` with scope `20 Projects/Vault MCP Connector/`.
7. Call `fetch` with the first returned id.
8. Call `fetch_note_by_path` with `20 Projects/Vault MCP Connector/Project Home.md`.
9. Call `fetch` with `guessed-denied-id` and confirm it returns a tool error.
10. Call `fetch_note_by_path` with a denied path such as `02 Daily/2026-06-10.md` and confirm it returns a tool error.

## ChatGPT

1. Enable developer mode in the ChatGPT workspace.
2. Create a custom MCP connector/app.
3. Endpoint: `https://vault-mcp.example.com/mcp`.
4. Configure OAuth according to the provider backing `OAUTH_*`.
   - For self-hosted OAuth, the provider URL is the same as the MCP host, `https://vault-mcp.example.com`.
   - Use the connector password set in `OAUTH_AUTH_PASSWORD` when the authorization page opens.
5. Scan tools and confirm only the read-only vault tools appear; no write/edit tools should be present.
6. Prompt: `Search my vault for the Vault MCP Connector project and fetch the relevant note.`
7. Confirm the returned citation URL is under `/notes/:id`.
8. Confirm metadata includes `obsidian_uri`.
9. Confirm search/list/fetch responses are readable in the conversation, not just raw JSON.
10. If the ChatGPT client renders MCP output templates, confirm the vault results card appears from `ui://vault-mcp/results-v2.html`.
11. Prompt with a denied area request, such as raw daily notes or credentials, and confirm no denied path is returned.

## Claude

1. Add a custom remote MCP connector.
2. Endpoint: `https://vault-mcp.example.com/mcp`.
3. Configure the same OAuth provider.
   - For self-hosted OAuth, the connector URL and OAuth provider URL are both `https://vault-mcp.example.com`; Claude should discover metadata and dynamically register.
   - Use the connector password set in `OAUTH_AUTH_PASSWORD` when the authorization page opens.
4. Confirm Claude sees `search` and `fetch`.
5. Search and fetch `Vault MCP Connector`.
6. Confirm the same note chunk can be fetched as in ChatGPT.
7. Confirm guessed ids or denied sensitive paths are not accessible.

## Completion Evidence

Do not consider V1 complete until the project has:

- build/test/smoke logs
- remote smoke output
- MCP Inspector confirmation
- ChatGPT read-only discovery/fetch confirmation
- Claude read-only discovery/fetch confirmation
- denied-path/guessed-id confirmation
