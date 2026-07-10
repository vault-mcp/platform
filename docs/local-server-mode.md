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
- Keep local filesystem access off by default. When enabled, expose it as an
  explicit local-only policy with four modes: `off`, `read`, `write`, and
  `god`.
- Time-box enabled filesystem access with an optional session expiry. The
  plugin default is a 120-minute access window for each local-server start.
- In `read` mode, only configured read roots may be listed, searched, or read.
- In `write` mode, configured read roots still control listing/reading and
  configured write roots control writes.
- Local discovery is on-demand through `local_find_files` and
  `local_search_text`; it should happen only after a chat request, not as a
  background vault scan.
- Require a per-tool `user_intent` phrase by default for local filesystem tools.
  `local_fs_policy` exposes whether this is required and the exact phrase the
  client must send.
- Record successful write-side operations in a local JSONL audit file and expose
  recent entries through `local_fs_audit`.
- Write operations are separately allowlisted. The private-alpha operations are
  `write_file`, `edit_file`, `create_directory`, `copy_path`, `move_path`, and
  `delete_path`.
- `edit_file` replaces exact UTF-8 text only when the caller's
  `expected_replacements` count matches the file, which gives local-capable
  clients a targeted edit path that is safer than whole-file overwrite.
- `delete_path` requires an explicit confirmation string in the tool arguments.
- Scoped roots are checked against real filesystem targets. A symlink inside an
  allowed root that points outside that root is denied for local reads, writes,
  copies, moves, and deletes.
- In `god` mode, the localhost server removes root limits. This should be a
  deliberate user choice for high-trust local sessions only.
- Do not enumerate, read, or write local files unless the user asks for that
  specific interaction in the chat.

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

Current private-alpha status: Slice 1 is implemented, Slice 2 has a
Node-required launcher, and the ZIP package includes a bundled Node sidecar
artifact. The plugin now shows a `Local desktop server`
settings section, saves the planned local port, keep-alive preference, local
data folder, and local-only MCP/admin tokens, renders the future localhost MCP
endpoint, can generate or rotate those local credentials, and can copy a
developer launch command. It can start and stop the packaged sidecar when the
installed plugin folder contains `sidecar/start-local-server.mjs`, or fall back
to the Node-required developer local server profile when the tester configures
the platform repo folder and npm command. A platform-native binary sidecar is
still future work. After spawning the local profile, the plugin waits for
`/healthz` before showing the server as ready; if health or storage readiness
fails, it stops the child process and leaves local mode disabled. It also
requires the health response to identify `vault-mcp-connector`, match the
plugin manifest version, and advertise the expected localhost MCP endpoint, so
a stale or unrelated process on the same port is not treated as ready. Start
treats the configured port as preferred: if that port is free it uses it, if a
compatible Vault MCP server is already listening it reuses that server, and if
the port is occupied by something incompatible it scans upward for the next
available port. The repo also includes `npm run local-server`, which starts the
existing server with localhost-only defaults, JSON storage, generated or
provided local tokens, and MCP Inspector origins. `npm run smoke:local-server`
verifies that profile against the synthetic `fixtures/vault` demo vault.

Developer local-server start:

```bash
npm run local-server -- --port 38791 --data-dir data/local-server --mcp-token <local-mcp-token> --sync-token <local-sync-token>
```

Developer local-server start with scoped local filesystem access:

```bash
npm run local-server -- \
  --port 38791 \
  --data-dir data/local-server \
  --mcp-token <local-mcp-token> \
  --sync-token <local-sync-token> \
  --fs-access write \
  --fs-roots "/absolute/path/to/vault" \
  --fs-write-roots "/absolute/path/to/vault/20 Projects" \
  --fs-write-operations "write_file,edit_file,create_directory,copy_path,move_path,delete_path" \
  --fs-max-read-bytes 524288 \
  --fs-max-search-results 100 \
  --fs-max-search-files 2000 \
  --fs-access-ttl-minutes 120 \
  --fs-require-user-intent true \
  --fs-user-intent-phrase "use local filesystem"
```

The plugin settings UI can generate the same flags from `Local filesystem
access`, `Local filesystem read roots`, `Local filesystem write roots`, and
`Allowed local write operations`, `Local max read bytes`, `Local max search
results`, `Local max searched files`, `Local access session minutes`,
`Require local user intent`, and `Local user intent phrase`.
When the session window expires, the server keeps `local_fs_policy` and
`local_fs_audit` visible so clients can explain what happened and review recent
successful write-side operations, but it stops advertising local list, read,
byte-read, search, and write tools until the local server is restarted or
refreshed.
The plugin settings UI exposes `Refresh session` and the command palette
exposes `Refresh local filesystem access session`; both restart the developer
local server profile with a fresh expiry window.

When intent is required, local clients should first call `local_fs_policy`.
Then any `local_list_files`, `local_read_file`, `local_read_file_bytes`,
`local_file_info`, `local_find_files`, `local_search_text`,
`local_write_file`, `local_write_file_bytes`, `local_edit_file`,
`local_create_directory`, `local_copy_path`, `local_move_path`,
`local_delete_path`, or `local_fs_audit` call must include:

```json
{
  "user_intent": "use local filesystem"
}
```

Use `local_read_file` and `local_write_file` for UTF-8 text. Use
`local_read_file_bytes` and `local_write_file_bytes` when exact bytes matter or
the file is binary; those tools exchange content as standard base64 and still
respect the configured read roots, write roots, `write_file` allowlist,
session expiry, and `user_intent` requirement.
Use `local_edit_file` for surgical UTF-8 edits when the client can provide the
exact `old_text`, `new_text`, and expected replacement count.

Changing the phrase in the plugin changes the value clients must send. This is
not a replacement for the bearer token, roots, write-operation allowlist,
session expiry, or delete confirmation; it is an additional local interaction
gate.

Headless local-server verification:

```bash
npm run smoke:local-server
npm run smoke:local-fs
npm run smoke:local-inspector
```

`smoke:local-server` starts the local profile with fixed test-only tokens,
syncs the synthetic demo vault, verifies JSON storage, checks MCP
authentication, searches/fetches an allowed demo note, confirms a denied
daily-note path stays unavailable, checks scoped vault status, and removes its
temporary data folder.

`smoke:local-fs` starts separate localhost servers with enabled filesystem
policies. It verifies scoped write mode exposes the expected local tools,
lists/reads/finds/searches only inside the configured read root, writes,
creates directories, moves, and deletes only inside the configured write root,
denies missing `user_intent`, denies outside paths, requires delete
confirmation, verifies active session expiry metadata, verifies an expired
session exposes policy-only behavior, and verifies god mode can
read/write/search/move/delete an absolute temporary path without configured
roots.

`smoke:local-inspector` starts a localhost server with Inspector-compatible
origins and verifies CORS preflight from `http://localhost:6274` and
`http://127.0.0.1:6274`, authenticated SSE, forbidden-origin rejection, and
local filesystem tool calls from an Inspector-origin request. It covers the
server/protocol side of Inspector setup; a human still needs to verify the
actual Inspector UI before release claims.

The command prints:

- MCP endpoint, defaulting to `http://127.0.0.1:38791/mcp`
- `/healthz` URL
- local JSON index path
- generated MCP access token for local clients
- generated plugin/admin sync token for local sync

These printed tokens are local secrets. Do not paste them into docs,
screenshots, or chat transcripts. The current plugin can generate and store
these values, copy a launch command that passes them to the packaged or
developer local profile, and start or stop that local profile from the plugin.
It can also copy a local client connection bundle for local-capable MCP clients:
the bundle includes the localhost `/mcp` endpoint, an `Authorization: Bearer ...`
header built from the local MCP client token, a generic `mcpServers`
configuration example, and a `local_filesystem` section with the current mode,
roots, write operations, caps, session window, and `user_intent` requirement.
It intentionally does not include the plugin/admin sync token. The same setting
can copy local client instructions without embedding any bearer or sync token;
that prompt is meant for ChatGPT Desktop, Claude Desktop, Codex, MCP Inspector,
or another local-capable client so it knows to call `local_fs_policy` before
local file work and to include the exact `user_intent` phrase when required.
The ZIP package removes the repo-folder requirement by including a bundled Node
sidecar; BRAT/dev installs without that folder still use the developer repo
fallback.

### Slice 1 - Design And Compatibility

- [x] Add local server mode to plugin setup guide as planned.
- [x] Add this architecture doc.
- [x] Add settings fields but keep the toggle disabled until the sidecar exists.
- [x] Document desktop-only and localhost-client limitations.

### Slice 2 - Sidecar Build

- [x] Add a Node-required `scripts/start-local-server.mjs` local server profile
  that wraps the existing server app with localhost defaults.
- [x] Build a bundled Node sidecar artifact for the ZIP/plugin package.
- Build a platform-native binary sidecar for macOS, Windows, and Linux, or keep
  documenting the Node-required private-alpha path.
- [x] Reuse existing `/healthz`, `/mcp`, `/admin/vaults/:vaultId/sync`,
  `/admin/vaults`, and write-proposal endpoints in local profile.
- [x] Use local JSON storage by default, not Postgres.

### Slice 3 - Plugin Lifecycle

- [x] Start/stop the Node-required developer sidecar from the plugin.
- [x] Auto-select a port.
- [x] Generate local tokens for the developer launch path.
- [x] Health-check the sidecar before marking local mode ready.
- [x] Version-check the sidecar before marking local mode ready.
- Sync the current vault after preview/approval.
- [x] Show copyable local MCP endpoint, tokens, and developer launch command.
- [x] Add plugin-controlled local filesystem access settings and local MCP
  tools for policy, listing, reading, and scoped writing.
- [x] Bundle a Node sidecar in the ZIP package so users do not need a repo
  checkout when the installed package includes the `sidecar` folder.
- Bundle a platform-specific binary sidecar so non-developer users do not need
  any Node/npm command.

### Slice 4 - Verification

- [x] Unit-test local settings, setup-guide states, credential facts, and launch
  command generation.
- [x] Add a headless local-server smoke gate.
- [x] Add a headless enabled local-filesystem MCP policy smoke gate.
- [x] Add a headless MCP Inspector-origin smoke gate for localhost local tools.
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
