# Local Desktop Server Mode

Local desktop server mode is the planned no-cloud path for users who want Vault
MCP to run only on the same computer as Obsidian. The user installs the Obsidian
plugin, turns on local server mode, and the plugin starts a localhost MCP server
while that vault is open.

This should become the simplest path for privacy-first desktop users:

1. Install the Obsidian plugin.
2. Open Vault MCP settings.
3. Toggle `Run local MCP server`.
4. Copy the local MCP endpoint into ChatGPT Desktop, Claude Desktop, Codex, MCP
   Inspector, or another local-capable MCP client.
5. Keep Obsidian open when clients need vault access.

## Product Shape

Local mode should sit beside the existing hosting choices:

- Managed Vault MCP: hosted service, future simplest multi-device path.
- Guided Vercel self-host: private-alpha remote server path.
- Local desktop server: no-cloud localhost server controlled by the plugin.
- Advanced manual hosting: developer path for terminal/container users.

The local server option is desktop-only. Obsidian's plugin guidelines state that
Node.js and Electron APIs are not available on mobile, and this mode needs a
local process, loopback server, file-system adjacent packaging, and process
lifecycle management.

## Recommended Architecture

Use a plugin-managed sidecar process instead of embedding the Express server
directly into the plugin bundle.

The current plugin build targets `--platform=browser` and bundles to a single
CommonJS `main.js` file for Obsidian. The hosted server is a Node HTTP service
with Express, OAuth, Postgres/JSON storage, and MCP SDK dependencies. Bundling
that whole server into the renderer plugin would make the plugin heavier,
harder to test, and more fragile across Obsidian/Electron environments.

The sidecar model keeps responsibilities clean:

- `apps/obsidian-plugin`: UI, indexing policy, approvals, sync, server lifecycle.
- `apps/local-server` or `apps/server --local`: localhost MCP/OAuth/admin API.
- `packages/core`: shared indexing, policy, redaction, search, and write types.

The first implementation can reuse the existing server app with a local profile:

- host: `127.0.0.1`
- port: auto-select from a configured range, for example `38791-38820`
- storage: local JSON or SQLite in the plugin data folder
- auth: generated local access token for local clients plus generated admin sync
  token for plugin-to-server calls
- origins: `http://localhost:*`, `http://127.0.0.1:*`, MCP Inspector origins,
  and any configured desktop-client origins

## Lifecycle

When enabled, the plugin should:

1. Check that Obsidian is running on desktop.
2. Check whether the configured local port is already serving Vault MCP.
3. Start the sidecar if no compatible server is running.
4. Wait for `/healthz`.
5. Store local-only endpoint details in plugin settings.
6. Register/sync the current vault using the same policy preview path as remote
   mode.
7. Show the local MCP endpoint and copy buttons in the setup guide.
8. Stop the sidecar when Obsidian unloads, unless the user opts into keeping it
   alive.

If startup fails, the UI should show one of a few clear states:

- Node runtime unavailable.
- Sidecar binary missing or damaged.
- Port in use.
- Health check failed.
- Local token mismatch.
- Server version mismatch.

## Security Model

Local mode is not "no auth." It still needs local credentials because other
local processes can call localhost.

Minimum private-alpha rules:

- Bind only to `127.0.0.1`, never `0.0.0.0`.
- Generate a per-vault local admin sync token.
- Generate a separate local MCP access token or localhost OAuth password for
  MCP clients.
- Never expose the plugin admin sync token to MCP clients.
- Rotate local credentials from the plugin UI.
- Store local credentials in Obsidian plugin settings only, never in docs or
  screenshots.
- Keep indexing policy, redaction, and manual approvals identical to remote
  mode.
- Keep writes proposal-first; the local server may store proposals, but the
  plugin still applies writes after local review/hash checks.

## Client Setup

Local clients should receive:

```text
MCP endpoint: http://127.0.0.1:<port>/mcp
Authorization: generated local MCP token or local OAuth flow
Vault id: <current vault id>
```

For clients that cannot connect to localhost from their runtime, the plugin
should recommend guided Vercel self-hosting or managed hosting instead.

This matters for browser-hosted clients. A web app running in a remote browser
context generally cannot reach a server on the user's private localhost unless
the client platform provides a desktop bridge. Local mode should therefore be
positioned as best for desktop MCP clients and development tools, not as a
universal ChatGPT web replacement.

## Implementation Slices

Current private-alpha status: Slice 1 is implemented and Slice 2 has a
developer/Node-required launcher. The plugin now shows a `Local desktop server`
settings section, saves the planned local port, keep-alive preference, local
data folder, and local-only MCP/admin tokens, renders the future localhost MCP
endpoint, can generate or rotate those local credentials, and can copy a
developer launch command. The `Run local MCP server` toggle stays disabled
until plugin-managed lifecycle exists. The repo also includes `npm run
local-server`, which starts the existing server with localhost-only defaults,
JSON storage, generated or provided local tokens, and MCP Inspector origins.
`npm run smoke:local-server` verifies that profile against the synthetic
`fixtures/vault` demo vault.

Developer local-server start:

```bash
npm run local-server -- --port 38791 --data-dir data/local-server --mcp-token <local-mcp-token> --sync-token <local-sync-token>
```

Headless local-server verification:

```bash
npm run smoke:local-server
```

That smoke starts the local profile with fixed test-only tokens, syncs the
synthetic demo vault, verifies JSON storage, checks MCP authentication,
searches/fetches an allowed demo note, confirms a denied daily-note path stays
unavailable, checks scoped vault status, and removes its temporary data folder.

The command prints:

- MCP endpoint, defaulting to `http://127.0.0.1:38791/mcp`
- `/healthz` URL
- local JSON index path
- generated MCP access token for local clients
- generated plugin/admin sync token for local sync

These printed tokens are local secrets. Do not paste them into docs,
screenshots, or chat transcripts. The current plugin can generate and store
these values, then copy a developer launch command that passes them to the
Node-required local profile. A future plugin-managed version should start and
stop the sidecar directly instead of asking the user to run that command.

### Slice 1 - Design And Compatibility

- [x] Add local server mode to plugin setup guide as planned.
- [x] Add this architecture doc.
- [x] Add settings fields but keep the toggle disabled until the sidecar exists.
- [x] Document desktop-only and localhost-client limitations.

### Slice 2 - Sidecar Build

- [x] Add a Node-required `scripts/start-local-server.mjs` local server profile
  that wraps the existing server app with localhost defaults.
- Build a single sidecar artifact for macOS, Windows, and Linux, or document a
  Node-required private-alpha path first.
- [x] Reuse existing `/healthz`, `/mcp`, `/admin/vaults/:vaultId/sync`,
  `/admin/vaults`, and write-proposal endpoints in local profile.
- [x] Use local JSON storage by default, not Postgres.

### Slice 3 - Plugin Lifecycle

- Start/stop the sidecar from the plugin.
- Auto-select a port.
- [x] Generate local tokens for the developer launch path.
- Health-check and version-check the sidecar.
- Sync the current vault after preview/approval.
- [x] Show copyable local MCP endpoint, tokens, and developer launch command.

### Slice 4 - Verification

- [x] Unit-test local settings, setup-guide states, credential facts, and launch
  command generation.
- [x] Add a headless local-server smoke gate.
- Add a disposable-vault Obsidian smoke for toggle/start/sync/stop.
- Add MCP Inspector acceptance against `http://127.0.0.1:<port>/mcp`.
- Add client docs for Codex, Claude Desktop, ChatGPT Desktop if supported, and
  MCP Inspector.

## Open Questions

- Should the sidecar be bundled as a platform-specific binary, or should private
  alpha require the user to have Node installed?
- Should local mode use static local tokens first, then OAuth later?
- Should the sidecar stop on Obsidian unload by default, or keep running until
  the user stops it?
- Where should local server logs live, and how should the plugin expose them
  without leaking note content?
- Can ChatGPT's target client reach localhost in the user's desired ChatGPT
  surface, or does it require remote hosting?
