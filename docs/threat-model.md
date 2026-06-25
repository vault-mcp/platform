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
- V1 is read-only.
- `/mcp` and `/notes/:id` require either `MCP_ACCESS_TOKEN` for local development or a valid OAuth JWT in production.
- `/admin/sync` requires separate `MCP_SYNC_TOKEN`.
- OAuth protected-resource metadata is exposed for MCP clients.
- Local server defaults to `127.0.0.1`.
- Origin validation is enforced for `/mcp`.
- Note text is explicitly described as untrusted data in server instructions.
- The self-hosted OAuth flow issues scoped read-only access tokens and persists dynamic clients plus replay protection in production storage.
- Expanded discovery tools list only already-indexed allowlisted notes; denied paths remain unavailable through exact path fetches and scoped searches.
- ChatGPT-facing UI metadata and the `ui://vault-mcp/results.html` component only render existing read-only tool results; they do not add a separate data path or vault access path.
- Dependency audit is a release gate. The current dependency tree removes `gray-matter`/`js-yaml`, pins safe `hono` and `esbuild` versions through npm overrides, and requires `npm audit --audit-level=low` to pass before production deploys.

## Current Gaps

- Write access is intentionally not implemented yet. Future write tools need a separate threat model, stronger confirmation UX, audit history, and a rollback story before touching the live vault.
- The current ChatGPT UI pass is read-only and result-display focused. Future write-capable UI still needs separate design, confirmation, audit, backup, conflict-resolution, and rollback controls.
