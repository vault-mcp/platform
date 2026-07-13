# Acceptance Runbook

Use this after the remote HTTPS endpoint, Postgres, sync token, and OAuth provider are configured.
For first-time setup, start with [Self-Host Vault MCP](self-host.md).
For the planned localhost-only desktop path, see
[Local Desktop Server Mode](local-server-mode.md).

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
- `npm run smoke:local-fs`
- `npm run smoke:hosted-local-bridge`
- `npm run smoke:local-inspector`
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

After preparing the evidence reports for BRAT UI, fresh self-hosting, real
clients, and security review, check the aggregate release-readiness status:

```bash
npm run release:readiness
```

Strict aggregate gate:

```bash
npm run release:readiness:verify
```

This command does not run the external/manual gates for you. It reads the local
evidence reports and shows which release-readiness reports are complete,
missing, or still incomplete.

For focused reruns:

```bash
npm run build
npm run check:api
npm test
npm run smoke:mcp-ui
npm run smoke:local-fs
npm run smoke:hosted-local-bridge
npm run smoke:local-inspector
npm run smoke:local
npm run smoke:oauth-local
```

Run server-starting local smoke scripts sequentially unless they use distinct
ports. `smoke:local` and `smoke:oauth-local` use the local server app profile;
`smoke:local-fs` starts dedicated localhost servers on test ports for scoped
write mode, god mode, and expired-session policy-only behavior.
`smoke:hosted-local-bridge` starts separate hosted and localhost profiles,
simulates the plugin heartbeat/poll/forward/result loop, verifies an allowed
write and explicit read, and proves an outside-root write remains denied.
`smoke:local-inspector` starts a localhost server and
simulates MCP Inspector browser-origin traffic from `http://localhost:6274` and
`http://127.0.0.1:6274`.
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
3. Check copied-vault BRAT readiness:

```bash
npm run plugin:brat:check-copy -- --check-github-release
```

4. If needed, enable BRAT and add the repo in the copied vault:

```bash
npm run plugin:brat:check-copy -- --enable-brat --add-repo --check-github-release
```

5. If the repo is private, add a fine-grained GitHub token in BRAT settings with
   read-only Contents access to `vault-mcp/platform`. Do not put that token in
   source code, screenshots, or docs.
6. Install through BRAT into `/Users/tjt/Documents/Tristan's Personal vault copy`
   or another disposable vault.
7. Enable `Vault MCP`.
8. Import the setup bundle or paste server settings.
9. Run `Check connection`, `Preview index`, and a copied-vault sync.
10. Capture screenshots of the BRAT install, enabled plugin, readiness checklist,
   preview queue, and sync summary.
11. Verify the installed copied-vault runtime files match the GitHub BRAT
   release assets:

```bash
npm run plugin:brat:verify-copy-install
```

12. Prepare, capture, and verify the screenshot-backed BRAT UI evidence:

```bash
npm run plugin:brat:prepare-ui-evidence
npm run plugin:brat:evidence-status
npm run plugin:brat:verify-ui-evidence
```

Use [BRAT Private Alpha Walkthrough](brat-private-alpha-walkthrough.md) for the
required screenshots and report format.

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

Private-alpha hosted proposal acceptance is a separate opt-in gate:

1. Set `MCP_WRITE_PROPOSALS_ENABLED=true` and include `vault:write` in
   `OAUTH_SCOPES`.
2. Reauthorize the MCP client and confirm its token scope includes
   `vault:read vault:write`.
3. Fetch an indexed test note and keep its `metadata.content_hash`.
4. Call `propose_vault_write` with `append_to_note`, the exact path, that hash,
   and harmless test content.
5. Confirm ChatGPT renders a pending proposal card and explicitly says the vault
   has not changed.
6. Open the disposable vault in Obsidian, review the proposal diff, approve it,
   and apply it locally.
7. Call `list_write_proposals` and confirm the same proposal is `applied` with
   an audit trail.
8. Confirm the disposable vault contains the change plus backup/audit notes.
9. Repeat with a stale hash and confirm the MCP tool refuses to queue it.

Do not run this acceptance against the live personal vault. Return production
to read-only scopes after the test if proposal writes are not meant to remain
enabled.

Private-alpha hosted desktop acceptance is also opt-in:

1. Set `MCP_REMOTE_LOCAL_FS_ENABLED=true` and include `local:access` in
   `OAUTH_SCOPES`; keep production off until this gate passes.
2. Install the current plugin build in a disposable copied vault and configure
   its hosted server URL, sync token, vault id, and installation id.
3. In `Local desktop server`, choose a narrow Read or Write policy, add only the
   disposable root, set a short expiry, and keep exact user intent enabled.
4. Enable `Allow hosted ChatGPT to use local tools` and confirm the plugin shows
   a successful poll rather than a stale/error state.
5. Reauthorize ChatGPT, call `desktop_local_fs_status`, and verify its policy
   exactly matches the plugin.
6. Ask ChatGPT to write one harmless file inside the disposable root. Confirm
   `desktop_run_local_tool` returns the localhost MCP result and the local JSONL
   audit contains the write.
7. Try a path outside the root and a wrong intent phrase; both must fail and no
   outside file may appear.
8. Refresh into God mode only for a separate throwaway-root test, verify status,
   then disable the bridge and stop/expire the local session immediately.
9. Re-enable the bridge once, close and reopen Obsidian, and confirm the hosted
   bridge is Off until the user explicitly enables it again.
10. Confirm hosted tools disappear when the server flag/scope is removed and
   calls fail when Obsidian is closed or its heartbeat becomes stale.

Never run the write/god-mode acceptance against the live personal vault.

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

The automated local origin/protocol gate is:

```bash
npm run smoke:local-inspector
```

It verifies Inspector localhost origins, browser preflight, authenticated SSE,
forbidden-origin rejection, and local filesystem tool calls through an
Inspector-origin request. This does not replace clicking through the MCP
Inspector UI.

Remote/manual Inspector acceptance:

1. Start from a synced endpoint.
2. Run:

```bash
npx @modelcontextprotocol/inspector https://vault-mcp.example.com/mcp
```

3. Provide an `Authorization: Bearer ...` header.
4. Confirm `tools/list` returns the read-only tool set: `search`, `search_notes`, `search_sections`, `list_notes`, `recent_notes`, `active_projects`, `fetch`, `fetch_note_by_path`, `get_index_status`, `list_vaults`, `get_vault_status`, and `debug_search`. When proposal mode and `vault:write` are intentionally enabled, also expect `propose_vault_write` and `list_write_proposals`.
5. Call `search` with `Vault MCP Connector`.
6. Call `list_notes` with scope `20 Projects/Vault MCP Connector/`.
7. Call `fetch` with the first returned id.
8. Call `fetch_note_by_path` with `20 Projects/Vault MCP Connector/Project Home.md`.
9. Call `fetch` with `guessed-denied-id` and confirm it returns a tool error.
10. Call `fetch_note_by_path` with a denied path such as `02 Daily/2026-06-10.md` and confirm it returns a tool error.

## Structured Client Evidence

The real-client checks are manual, but the evidence should still be structured.
Before starting MCP Inspector, ChatGPT, Codex, and Claude or another non-OpenAI
client, prepare a local report:

```bash
npm run acceptance:prepare
```

This writes:

```text
dist/acceptance/client-acceptance-report.json
```

Fill it with non-secret evidence after each client pass. Do not paste OAuth
passwords, bearer tokens, sync tokens, GitHub tokens, or private note bodies
into the report. Use `evidenceRefs` for local screenshot paths, browser URLs,
log file paths, PR/check URLs, or short non-secret notes.

Check progress without failing:

```bash
npm run acceptance:status
```

Final strict gate:

```bash
npm run acceptance:verify
```

The verifier requires every real client to connect, list only the read-only tool
surface, search, fetch, deny guessed ids, deny denied paths, and include at
least one evidence reference. ChatGPT also requires first-render MCP UI and
clean fetched-note rendering evidence. The Claude slot can be filled by Claude
or another non-OpenAI MCP client, but the report must name the client.

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
