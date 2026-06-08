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

## Current Gaps

- The app validates OAuth access tokens but does not issue tokens; provider configuration remains external.
- Public deployment, TLS termination, and refresh-token handling still need production configuration.
