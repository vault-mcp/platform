# Threat Model

## Assets

- Live Obsidian vault contents.
- Sensitive/review-gated notes, credentials, finance, legal, identity, and raw daily notes.
- Derived MCP index.
- MCP access and sync tokens.

## Trust Boundaries

- The indexer is local and reads the vault.
- The server does not read the vault; it serves only synced documents.
- MCP clients receive untrusted note content for context and citation only.

## Controls

- Denylist rules run before allowlist rules.
- V1 selects only specific technical/reference subfolders under `40 Reference/`; prompt archives, business-development references, client/process archives, and other unselected reference folders are denied by default.
- Hosted reads remain allowlisted and read-only. Private-alpha proposal tools are a separate opt-in surface and never edit the vault directly.
- `/mcp` and `/notes/:id` require either `MCP_ACCESS_TOKEN` for local development or a valid OAuth JWT in production.
- `/admin/sync` requires separate `MCP_SYNC_TOKEN`.
- OAuth protected-resource metadata is exposed for MCP clients.
- Local server defaults to `127.0.0.1`.
- Origin validation is enforced for `/mcp`.
- Note text is explicitly described as untrusted data in server instructions.
- The self-hosted OAuth flow issues scoped access tokens and persists dynamic clients plus replay protection in production storage. Proposal tools require both `MCP_WRITE_PROPOSALS_ENABLED=true` and an authenticated `vault:write` scope; read-only tokens never receive those tools.
- Hosted desktop tools require a second server flag, an authenticated `local:access` scope, a fresh installation-scoped Obsidian heartbeat, an unexpired localhost policy, and the exact plugin-configured intent phrase before the server queues a request.
- Desktop requests are short-lived and installation-scoped. The Obsidian plugin polls outward, claims only requests for its own vault installation, forwards one call to the authenticated localhost MCP sidecar, and returns the result. The hosted server has no direct inbound path to the desktop and receives no proactive filesystem inventory.
- Completed or failed desktop request rows, including returned file content, are deleted after the request expiry timestamp; pending/running requests fail closed as expired. Operators should still treat the hosted database as temporarily sensitive during an active call.
- The localhost sidecar remains the filesystem authority for hosted calls. Read/write roots, write-operation toggles, access expiry, symlink hardening, byte/search caps, exact-edit match counts, delete confirmation, god mode, and JSONL write audit are enforced locally after a request is claimed.
- Expanded discovery tools list only already-indexed allowlisted notes; denied paths remain unavailable through exact path fetches and scoped searches.
- Existing-note proposals require a fresh indexed content hash, are limited to indexed notes, and are rechecked against the live local file by the Obsidian plugin. Unsafe paths, stale hashes, unsupported frontmatter payloads, and rename collisions visible in the index are refused before storage.
- ChatGPT-facing UI metadata and the `ui://vault-mcp/results-v2.html` component render tool results; they do not add a separate data path or vault access path. Proposal cards describe pending state and Obsidian-side review rather than presenting a server-side write as complete.
- `npm run smoke:mcp-ui` verifies the component in a dependency-free fake DOM with delayed tool globals. This is a render-regression gate only; real ChatGPT/MCP client acceptance is still required before public release claims.
- Dependency audit is a release gate. The current dependency tree removes `gray-matter`/`js-yaml`, pins safe `hono` and `esbuild` versions through npm overrides, and requires `npm audit --audit-level=low` to pass before production deploys.

## Current Gaps

- Proposal-only hosted writes are private-alpha and disabled by default. Real ChatGPT acceptance, reauthorization with `vault:write`, proposal-card UX review, and security-review evidence are still required before enabling them in production.
- The plugin applies proposals only after local policy/hash checks and creates backup/audit notes, but `direct_apply` remains reserved.
- The hosted desktop bridge is implemented but disabled by default and still needs real ChatGPT OAuth reauthorization, live Obsidian UI acceptance, and production security-review evidence before production enablement.
- Hosted bridge enablement is deliberately session-only: persisted plugin data always records it as off, and every Obsidian reload or reopen requires a fresh local enable action.
- The private-alpha plugin still authenticates sync and desktop-agent APIs with the deployment-wide `MCP_SYNC_TOKEN`. Managed multi-user hosting must replace this with revocable, per-installation credentials before public release.
- The packaged local server runs inside Obsidian's desktop Node context and does not require an external Node/npm command. A signed helper process may still be desirable later for stronger crash and process isolation, but it is not required for a no-terminal packaged install.

## Release Security Review Evidence

Before treating a private-alpha build as release-ready, prepare a structured
security review report:

```bash
npm run security:prepare
```

This writes:

```text
dist/security/security-review-report.json
```

Fill the report with non-secret evidence references for the current
implementation and docs. The report covers OAuth, origins, sync/admin scope,
tenant/vault isolation, indexing policy, write proposals, data boundaries, and
recovery. Do not paste OAuth passwords, bearer values, sync tokens, GitHub
tokens, database URLs, or private note bodies into the report.

Check progress:

```bash
npm run security:status
```

Final strict gate:

```bash
npm run security:verify
```

The verifier requires `privateAlphaAcceptable: true`, and intentionally fails if
the report marks public release or public write tools acceptable before those
separate gates are complete.
