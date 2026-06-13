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
- Added `apps/obsidian-plugin` with private-alpha settings, dashboard, sync command, index modes, write-mode placeholders, dry-run index preview, one-click review approvals, and a review queue view.
- Added Obsidian plugin write proposal review for pending server proposals, including approve/reject/conflict status updates, audit visibility, local base-hash checks, diff previews, and guarded local apply for approved create/append/replace/frontmatter/rename proposals with backup/audit notes.
- Added `scripts/install-obsidian-plugin.mjs` and `npm run plugin:install-copy` for installing the built plugin into the copied development vault.
- Added plugin helper and headless apply tests for write proposal content generation, rename target validation, frontmatter patch parsing, diff preview behavior, create/append/replace/frontmatter/rename apply paths, backups, and audit notes.
- Aligned manual approval policy so excluded paths still win, but explicit approvals can release notes held by sensitive metadata.
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
- Enforced multi-vault read disambiguation: when more than one vault has synced, search/list/fetch/status/debug tools require `vault_id` instead of reading across vaults by default.
- Kept write behavior as proposals only; no MCP tool directly edits an Obsidian vault.
- Fixed note grouping to use tenant + vault + path so two vaults can safely contain the same note path.

## Write Model

Write support starts as a proposal queue:

- The server stores `write_proposals` with operation type, target path, base content hash, proposed patch/content, requester, status, timestamps, and audit trail.
- The Obsidian plugin can pull proposals, analyze local target state, and mark pending proposals approved, rejected, or conflict.
- The Obsidian plugin can apply approved create/append/replace/frontmatter/rename proposals locally only after policy and hash checks allow it.
- `update_frontmatter` proposals store a JSON object in `proposed_content`; null values delete keys.
- `rename_note` proposals store the new vault-relative Markdown path in `proposed_content`.
- `patch_note` is intentionally excluded from the private-alpha write operation allowlist until an operation-specific patch parser/apply implementation is added.
- `review_required` remains the default plugin write mode.
- `direct_apply` is reserved for explicitly configured scopes and still needs local backup/audit entries.
- Base-content hash mismatches must move the proposal to review/conflict instead of overwriting the local file.

Obsidian writes use safe Obsidian APIs:

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
- `npm run plugin:install-copy`

The server contract tests include a two-vault fixture with overlapping note paths. They verify scoped `search`, `search_notes`, `search_sections`, `list_notes`, `recent_notes`, `active_projects`, `fetch`, `fetch_note_by_path`, `get_index_status`, `get_vault_status`, and `debug_search`, plus clear errors for unscoped reads when multiple vaults are connected.

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

For current Obsidian plugin testing steps, see `docs/plugin-private-alpha.md`.
