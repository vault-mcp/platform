# Vault MCP Obsidian Plugin 0.2.0

Public alpha release candidate for Obsidian Community Plugins.

## What Is Included

- A persistent Vault MCP sidebar for access level, local server state, ChatGPT local access, index status, sync, and write proposals.
- A self-contained local MCP server compiled into `main.js`; packaged users do not need Node, npm, or a separate sidecar folder.
- One local file access selector: Off, scoped Read, scoped Read/write, or GOD read/write.
- Direct scoped and GOD writes with create, overwrite, exact edit, directory create, copy, move/rename, delete, and local audit support.
- Plugin-controlled indexing rules, manual approvals, redaction reporting, remote sync, multi-vault status, and hosted write-proposal review.
- Setup guidance for local clients, hosted ChatGPT access, and self-hosted Vercel deployments.

## Safety Defaults

- Local filesystem access is Off by default.
- Hosted ChatGPT local access is disabled on every Obsidian startup and must be enabled for the current session.
- Scoped access enforces configured folders and operation permissions.
- GOD access is intentionally unrestricted and is labeled as such in the UI.
- Remote indexed-vault writes remain proposal-based; direct local writes do not create proposals or wait for Obsidian approval.
- The plugin does not include telemetry.

## Verification

- Full local release gate: build, typecheck, tests, audits, MCP smokes, package checks, clean install, lifecycle, and OAuth checks.
- Real Obsidian 1.12.7 clean install using only `manifest.json`, `main.js`, and `styles.css`.
- Embedded local server startup with no external Node installation.
- GOD-mode direct create, write, exact edit, copy, move, and delete in disposable test locations, followed by cleanup and reset to Off.

## Known Limitations

- Desktop only.
- Managed hosting onboarding is still alpha; local mode is the simplest no-cloud path for desktop MCP clients.
- Community directory availability depends on Obsidian review after submission.
