# Vault MCP V2 Migration

## Goal

Move Vault MCP from a single-vault, read-only private connector into a publishable private-alpha platform with two clear halves:

- An Obsidian plugin controls indexing, local sync, user approvals, and future vault writes.
- A hosted MCP server remains the OAuth/client boundary for ChatGPT, Claude, Codex, and other MCP clients.

The production alias should stay stable at `https://vault-mcp-connector.vercel.app` while the source repository moves into the `vault-mcp` GitHub organization.

## Repository Plan

- `vault-mcp/platform`: private implementation monorepo for server, plugin, CLI, shared packages, and reusable MCP UI.
- `vault-mcp/docs`: private docs/examples repo that can become public after the private alpha hardens.
- `TristanEDU/vault-mcp-connector`: temporary fallback until org CI, Vercel, preview smoke, and production smoke pass from `vault-mcp/platform`.

## Monorepo Shape

- `apps/server`: hosted MCP server, OAuth, storage, multi-vault APIs, and admin sync/proposal endpoints.
- `apps/obsidian-plugin`: plugin settings, dashboard, indexing controls, sync, and future write approvals.
- `apps/cli`: self-host/developer indexing, smoke-test, and admin helper workflows.
- `packages/core`: shared schemas, Markdown parsing, source policy, redaction, stable ids, sync types, and write proposal types.
- `packages/mcp-ui`: future home for reusable MCP Apps/ChatGPT UI once inline component HTML becomes too large.

## V2 Slice Implemented

- Renamed `packages/vault-core` to `packages/core`.
- Renamed `apps/indexer` to `apps/cli`.
- Added `apps/obsidian-plugin` with private-alpha settings, dashboard, sync command, index modes, and write-mode placeholders.
- Added shared V2 types for vault installations, index policies, sync manifests, vault status, write proposals, and write audit entries.
- Added configurable index modes:
  - `rules_plus_approvals`
  - `manual_only`
  - `rules_only`
- Added tenant/vault/installation identity fields to documents and sync payloads.
- Added scoped admin APIs for vault registration, per-vault sync, per-vault status, and write proposal lifecycle.
- Added MCP read tools:
  - `list_vaults`
  - `get_vault_status`
- Extended existing read tools with optional `vault_id` where applicable.
- Kept write behavior as proposals only; no MCP tool directly edits an Obsidian vault.
- Fixed note grouping to use tenant + vault + path so two vaults can safely contain the same note path.

## Write Model

Write support starts as a proposal queue:

- The server stores `write_proposals` with operation type, target path, base content hash, proposed patch/content, requester, status, timestamps, and audit trail.
- The Obsidian plugin will later pull proposals and apply them locally only after policy allows it.
- `review_required` remains the default plugin write mode.
- `direct_apply` is reserved for explicitly configured scopes and still needs local backup/audit entries.
- Base-content hash mismatches must move the proposal to review/conflict instead of overwriting the local file.

Future Obsidian writes should use Obsidian APIs:

- `Vault.process` for note edits.
- `FileManager.processFrontMatter` for frontmatter.
- `FileManager.renameFile` for renames.

## Verification

Current local gates:

- `npm run build`
- `npm test`
- `npm run check:api`
- `npm run smoke:local`
- `npm run smoke:oauth-local`

The local Postgres gate still requires `POSTGRES_SMOKE_DATABASE_URL`:

- `npm run smoke:postgres`

Migration gates after pushing to `vault-mcp/platform`:

- GitHub Actions pass from the org repo.
- Vercel project is reconnected to the org repo without changing production env vars.
- Preview deployment remote smoke passes.
- Production deployment remote smoke passes.
- ChatGPT and Claude manual connector acceptance still pass.

## Production Safety

Until the org migration is verified, keep the existing `TristanEDU/vault-mcp-connector` repo and production Vercel alias as fallback. Do not change production env vars or the `vault-mcp-connector.vercel.app` alias as part of source migration.
