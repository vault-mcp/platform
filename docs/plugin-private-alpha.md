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
- Reviews server-side write proposals, can mark pending proposals approved or rejected, and can apply approved create, append, replace, frontmatter, and rename proposals after local safety checks.

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

## Seed Write Proposals For UI Testing

Use the seeding script to create a repeatable set of pending write proposals for the copied vault. The script refuses to write fixtures unless the vault path contains `vault copy`.

```bash
set -a
source .env.production.local
source .env.oauth.local
set +a

npm run plugin:seed-write-proposals -- \
  --base-url "https://vault-mcp-connector.vercel.app" \
  --vault-root "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-id "default"
```

The script creates fixture notes under:

```text
20 Projects/Vault MCP Connector/Plugin UI Smoke/<run-id>/
```

It then creates pending proposals for:

- `create_note`
- `append_to_note`
- `replace_note`
- `update_frontmatter`
- `rename_note`

Use `--dry-run` to print the planned fixture paths and proposal payloads without writing local fixture notes or posting proposals.

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
- `patch_note` is not part of the private-alpha write surface yet; it needs a dedicated patch parser/apply implementation before the server should accept it.
- Plugin tests now cover pure write-proposal helper behavior and a headless apply harness for create, append, replace, frontmatter, rename, backup, and audit behavior. There is still no dedicated Obsidian UI/test harness for modal flows.
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
- local diff preview for create, append, replace, frontmatter, and rename proposals
- current proposal status
- audit trail

For pending proposals, the plugin can mark the proposal `approved`, `rejected`, or `conflict` on the server.

The plugin only shows `Approve` when the local safety analysis says the future apply path is compatible. If the target file is missing, the create target already exists, or the base content hash does not match the local file, the plugin offers `Mark conflict` instead.

After a proposal is approved, compatible proposals show `Apply locally`.

Local apply currently supports:

- `create_note`
- `append_to_note`
- `replace_note`
- `update_frontmatter`
- `rename_note`

For `update_frontmatter`, `proposed_content` must be a JSON object. String, number, boolean, and arrays of those values are written as frontmatter values. `null` deletes a frontmatter key.

For `rename_note`, `proposed_content` must be the new vault-relative Markdown path, for example:

```text
20 Projects/Vault MCP Connector/New Name.md
```

Before local apply, the plugin creates:

- a backup note containing the previous content
- an audit note containing proposal metadata, before/after hashes, backup path, and diff preview

The default audit folder is:

```text
00 System/Vault MCP Write Audit
```

Existing note edits use Obsidian's `Vault.process`. New note creation uses Obsidian's vault creation API. Frontmatter updates use Obsidian's `FileManager.processFrontMatter`. Renames use Obsidian's `FileManager.renameFile`. `patch_note` remains a future operation and is rejected by the server until it gets an operation-specific patch parser and apply implementation.

## Manual UI Verification

After seeding proposals, open the copied vault in Obsidian and use `Review write proposals`.

For each seeded proposal:

- Confirm the card shows the expected operation, target path, requester, local safety state, and diff preview.
- Click `Approve` and verify the status update succeeds.
- Refresh proposals, then click `Apply locally`.
- Confirm the target note changed as expected in the copied vault.
- Confirm a backup note and audit note were created under `00 System/Vault MCP Write Audit/<date>/`.

Expected results:

- `create_note` creates `Created From Proposal.md`.
- `append_to_note` appends one bullet to `Append Target.md`.
- `replace_note` replaces the body of `Replace Target.md`.
- `update_frontmatter` changes `status` to `active`, adds test tags, and removes `remove_me`.
- `rename_note` renames `Rename Target.md` to `Renamed By Proposal.md`.

This manual pass is still required before treating the plugin as publish-ready, because automated tests do not exercise Obsidian modal rendering or button wiring inside the actual app.
