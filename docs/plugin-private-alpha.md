# Obsidian Plugin Private Alpha

This guide covers the current V2 plugin slice. It is meant for local development and private-alpha testing against a copied vault, not for public release yet.

## What Works Now

- Installs the built plugin into an Obsidian vault copy.
- Lets the user configure the remote Vault MCP server URL, sync token, vault id, index mode, write mode, include rules, exclude rules, and manual allow rules.
- Previews index decisions before sync.
- Shows why each note is allowed, denied, or held for review.
- Lets the user approve a review-required note by exact path or approve its parent folder as a prefix.
- Keeps a short local activity history for previews, syncs, approvals, proposal checks, and errors.
- Syncs allowed Markdown chunks to the server through the per-vault sync endpoint.
- Reviews server-side write proposals and can mark pending proposals approved or rejected, but does not apply writes to local files yet.

## Safe Test Install

Build and install into the development vault copy:

```bash
npm run plugin:install-copy
```

The default target is:

```text
/Users/tjt/Documents/Tristan's Personal vault copy/.obsidian/plugins/vault-mcp
```

To choose another vault:

```bash
npm run plugin:install-copy -- --vault "/absolute/path/to/test vault"
```

To copy an already built plugin without rebuilding:

```bash
npm run plugin:install-copy:skip-build -- --vault "/absolute/path/to/test vault"
```

Do not point this workflow at the live vault until the private-alpha checklist passes.

## Obsidian Setup

1. Open the copied vault in Obsidian.
2. Go to Settings -> Community plugins.
3. Turn off Safe mode if Obsidian asks.
4. Enable `Vault MCP`.
5. Open the plugin settings.
6. Confirm the server URL, vault id, and index mode.
7. Paste the admin sync token.
8. Use the Vault MCP ribbon icon or command palette to open the dashboard.

## Index Modes

`rules_plus_approvals` is the default. Include and exclude prefixes decide normal notes. Notes with sensitive tags or statuses are held for review.

`manual_only` denies everything unless it appears in manual allow paths or manual allow prefixes.

`rules_only` relies on include and exclude prefixes, but sensitive metadata is denied instead of queued for review.

## Preview And Review Flow

Use `Preview index` before syncing.

The preview shows:

- scanned note count
- allowed note count
- review queue count
- denied note count
- redacted note count
- per-note policy reason
- matched rule
- path, status, tags, updated time, and approximate note size

Use `Review queue` to inspect notes that matched sensitive metadata.

Approval options:

- `Approve exact path` adds only that note to manual allow paths.
- `Approve folder` adds the note's parent folder to manual allow prefixes.

In `manual_only` mode, the preview also shows manual approval candidates for notes that are denied only because they do not have an explicit path or prefix approval yet.

Exclusions still win. If a note lives under an excluded prefix, approving it manually will not sync it until the exclusion is changed.

## Current Publishability Gaps

- The plugin is not packaged for the Obsidian community plugin process.
- Write proposals can be approved or rejected from Obsidian, but cannot be applied to local files yet.
- Plugin tests are still mostly covered through TypeScript/build checks instead of a dedicated Obsidian test harness.
- The installer is a local development script, not a release artifact.

## Write Proposal Review

Use `Review write proposals` from the dashboard to fetch proposals for the configured vault.

The proposal view shows:

- operation type
- target path
- requester
- base content hash prefix
- local content hash prefix when the target exists
- local safety status
- base-hash match or mismatch
- proposed content or patch preview
- local diff preview for create, append, and replace proposals
- current proposal status
- audit trail

For pending proposals, the plugin can mark the proposal `approved`, `rejected`, or `conflict` on the server. Approval does not edit local files yet.

The plugin only shows `Approve` when the local safety analysis says the future apply path is compatible. If the target file is missing, the create target already exists, or the base content hash does not match the local file, the plugin offers `Mark conflict` instead.

Local application still needs backup/audit creation and Obsidian API write paths. The current diff and hash checks are readiness gates, not a write implementation.
