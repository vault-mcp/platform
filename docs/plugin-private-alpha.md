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
- Shows a human-readable sync summary with scanned, denied, review-required, redacted, local chunk, and server-indexed counts.
- Converts common sync/proposal errors into actionable messages for missing token, bad server URL, unauthorized requests, missing endpoints, unreachable server, and server failures.
- Shows a safety boundary notice in settings and the dashboard explaining that the server stores a derived index, preview should run before sync, excludes win, the server does not directly edit Obsidian files, and local writes require plugin-side checks, backups, and audit notes.
- Shows a configuration readiness checklist in settings and the dashboard for server URL, sync token, vault id, index scope, exclusions, write mode, and write audit folder before a tester syncs.
- Provides a `Check connection` preflight in settings, the dashboard, and the command palette. It checks public server health, storage readiness, migration metadata, and the configured vault status when a sync token is saved.
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

## Private Alpha Package

Build a local installable package:

```bash
npm run plugin:package
```

This validates the plugin manifest, builds the plugin, stages the three Obsidian runtime files, and writes:

```text
dist/obsidian-plugin/vault-mcp/
dist/obsidian-plugin/vault-mcp-0.1.0.zip
dist/obsidian-plugin/vault-mcp-0.1.0.zip.sha256
dist/obsidian-plugin/vault-mcp-0.1.0-release-notes.md
dist/obsidian-plugin/vault-mcp-0.1.0-release.json
```

The package contains only:

- `manifest.json`
- `main.js`
- `styles.css`

Verify the package installs cleanly into a disposable generated vault:

```bash
npm run plugin:verify-package
```

This checks the zip checksum, extracts the package into a temporary vault under
`.obsidian/plugins/vault-mcp`, verifies the manifest matches the source
manifest, verifies `main.js` and `styles.css` are non-empty, validates release
notes and release metadata, and catches the common double-nested zip mistake
where files land under `.obsidian/plugins/vault-mcp/vault-mcp`.

To keep the generated disposable vault for inspection:

```bash
npm run plugin:verify-package -- --keep
```

This is a private-alpha artifact for copied-vault install testing. It is not yet a BRAT release or an Obsidian community-plugin submission.

## Manual Zip Install

For a private-alpha user who does not want to build from source:

1. Create this folder inside the test vault:

```text
.obsidian/plugins/vault-mcp
```

2. Unzip `vault-mcp-0.1.0.zip`.
3. Copy the inner `vault-mcp` folder contents into `.obsidian/plugins/vault-mcp`.
4. Confirm these files exist:

```text
.obsidian/plugins/vault-mcp/manifest.json
.obsidian/plugins/vault-mcp/main.js
.obsidian/plugins/vault-mcp/styles.css
```

5. Restart Obsidian or reload community plugins.
6. Open Settings -> Community plugins and enable `Vault MCP`.

For first private-alpha testing, use a copied or disposable vault. Do not use a live vault until the copied-vault UI verification gate passes.

## Upgrade

Manual upgrade for a private-alpha zip:

1. Quit Obsidian or disable `Vault MCP` in Community plugins.
2. Back up the current plugin folder if you want a rollback point:

```text
.obsidian/plugins/vault-mcp
```

3. Replace only these files from the new zip:

```text
manifest.json
main.js
styles.css
```

4. Leave `.obsidian/plugins/vault-mcp/data.json` in place if it exists. Obsidian uses that file for local plugin settings.
5. Reopen Obsidian or re-enable the plugin.
6. Open the Vault MCP dashboard and run `Preview index` before syncing.

If the new version changes settings shape, the release notes must say so explicitly before a private-alpha user upgrades.

## Uninstall

Manual uninstall:

1. Open Settings -> Community plugins.
2. Disable `Vault MCP`.
3. Quit Obsidian.
4. Delete:

```text
.obsidian/plugins/vault-mcp
```

This removes the plugin and local plugin settings. It does not delete notes that the plugin created during write-proposal apply testing. If write-proposal testing was enabled, review the audit folder before deleting anything:

```text
00 System/Vault MCP Write Audit
```

## Troubleshooting

### Plugin Does Not Appear In Obsidian

Check that the files are nested exactly once:

```text
.obsidian/plugins/vault-mcp/manifest.json
.obsidian/plugins/vault-mcp/main.js
.obsidian/plugins/vault-mcp/styles.css
```

If the zip was extracted as `.obsidian/plugins/vault-mcp/vault-mcp/manifest.json`, move the inner files up one folder.

### Plugin Appears But Will Not Enable

Confirm Obsidian is at least the plugin manifest's `minAppVersion`. The current private-alpha manifest requires:

```text
1.5.0
```

Then open Obsidian's developer console and check for a startup error. In private alpha, treat startup errors as release blockers.

### Sync Fails With Unauthorized Or Forbidden

Check:

- Server URL has no trailing path unless intentionally using a local server. Production is `https://vault-mcp-connector.vercel.app`.
- Sync token matches the server's configured admin sync token.
- Vault id is the intended id, usually `default` for the current single-vault setup.
- The server is reachable at `/healthz`.

The dashboard keeps the last error and shows suggested fixes for common failures. If the error says the endpoint was not found, make sure the Server URL is the base URL and not `https://.../mcp` or `https://.../admin`.

Do not paste tokens into screenshots, issue descriptions, or public docs.

### Preview Shows Too Many Denied Notes

Check the selected index mode:

- `rules_plus_approvals` uses include/exclude rules and queues sensitive metadata for review.
- `manual_only` denies everything until explicitly approved.
- `rules_only` denies sensitive metadata instead of queueing it.

Also check exclude prefixes. Exclusions win over manual approvals.

### Write Proposal Cannot Be Approved Or Applied

The plugin blocks approval/apply when local safety checks fail. Common reasons:

- The target note is missing.
- A create target already exists.
- The local file hash does not match the proposal's base content hash.
- The operation is not supported in the current private-alpha surface.

Do not override these checks manually. Mark the proposal `conflict`, inspect the audit trail, and create a new proposal from the current file state.

## Known Limitations

- The plugin is private-alpha software and should be tested against copied vaults first.
- There is no BRAT release or Obsidian community-plugin release yet.
- `patch_note` proposals are rejected until a safe parser/apply implementation exists.
- `direct_apply` should stay disabled until separately reviewed.
- The server stores a derived searchable index; it should not be treated as the canonical vault.
- The current production smoke uses the copied vault, not the live vault.
- Manual Obsidian UI click-through is still required before calling the plugin publish-ready.
- Multi-vault support exists in the architecture, but needs more leakage tests before public release.

## Privacy And Security Notes

- The plugin scans local Markdown files according to the configured index policy.
- The plugin displays its safety boundary in settings and the dashboard so testers can see the active index mode, write mode, audit folder, and server/write split before syncing or applying proposals.
- The plugin displays configuration blockers and warnings before sync. A blocked checklist item should be fixed before running `Sync now`; warnings are allowed but should be reviewed deliberately.
- The plugin syncs derived Markdown chunks and metadata to the configured server.
- The plugin should not sync denied paths, excluded prefixes, or notes held for review unless the user approves them under the selected mode.
- The server should never directly write to an Obsidian vault. Writes are proposal-first.
- Local write application happens in the plugin after approval and local safety checks.
- Supported local writes create backup and audit notes before applying changes.
- Base-content hash mismatches block automatic apply and should become conflicts.
- Sync tokens and OAuth secrets are credentials. Keep them in local ignored env/settings files and out of screenshots, commits, and public docs.
- Public release docs must remove Tristan-specific vault paths and use demo vault paths instead.

## Seed Write Proposals For UI Testing

Use the preparation script before manual UI verification. It installs the current plugin build into the copied vault, writes safe UI-smoke settings, seeds a fresh set of pending write proposals, and verifies the batch in initial mode.

The safe settings intentionally use:

- `vaultId`: `default`
- `indexMode`: `rules_plus_approvals`
- `writeMode`: `review_required`
- narrow default include prefixes
- sensitive default exclude prefixes
- `00 System/Vault MCP Write Audit` as the audit folder

```bash
set -a
source .env.production.local
source .env.oauth.local
set +a

npm run plugin:prepare-ui-smoke -- \
  --base-url "https://vault-mcp-connector.vercel.app" \
  --vault-root "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-id "default"
```

The script refuses to write fixtures unless the vault path contains `vault copy`. It creates fixture notes under:

```text
20 Projects/Vault MCP Connector/Plugin UI Smoke/<run-id>/
```

It then creates pending proposals for:

- `create_note`
- `append_to_note`
- `replace_note`
- `update_frontmatter`
- `rename_note`

Use `--dry-run` to print the planned plugin settings, fixture paths, and proposal payloads without writing local plugin settings, local fixture notes, or server proposals.

The preparation script runs this initial verifier automatically:

```bash
npm run plugin:verify-ui-smoke -- \
  --base-url "https://vault-mcp-connector.vercel.app" \
  --vault-root "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-id "default" \
  --run-id "<run-id>" \
  --mode initial
```

Use `npm run plugin:seed-write-proposals` directly only when you deliberately do not want to reset copied-vault plugin settings. For normal private-alpha UI verification, prefer `plugin:prepare-ui-smoke` so the plugin and seeded proposals use the same vault id and safe write mode.

## Obsidian Setup

1. Open the copied vault in Obsidian.
2. Go to Settings -> Community plugins.
3. Turn off Safe mode if Obsidian asks.
4. Enable `Vault MCP`.
5. Open the plugin settings.
6. Confirm the server URL, vault id, and index mode.
7. Paste the admin sync token.
8. Click `Check connection`. A ready result means the server health check works and the sync token can read the configured vault status.
9. Use the Vault MCP ribbon icon or command palette to open the dashboard.

## Connection Preflight

Run `Check connection` before previewing, syncing, or reviewing write proposals.

The check does two things:

- Calls `/healthz` on the configured server without credentials. This proves the base server URL is reachable and reports server version, storage type, storage readiness, migrations, total indexed chunks, connected vault count, and last sync time when available.
- If a sync token is saved, calls `/admin/vaults/<vault-id>/status` with the token. This proves the plugin can access the configured vault admin surface before it tries to sync or review write proposals.

Result meanings:

- `Server and vault connection ready`: the server is healthy and the saved sync token can read this vault's status.
- `Server reachable`: public health works, but no sync token is saved yet. Add the token before syncing.
- `Server reachable, storage not ready`: the server responded, but storage is unhealthy. Check deployment logs and database configuration.
- `Server check failed`: the URL is wrong, the server is unreachable, the endpoint returned an error, or the sync token was rejected.

If connection preflight fails, do not sync. Fix the server URL, sync token, or deployment health first.

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

- The plugin has a local private-alpha zip package, but it is not packaged for the Obsidian community plugin process.
- `patch_note` is not part of the private-alpha write surface yet; it needs a dedicated patch parser/apply implementation before the server should accept it.
- Plugin tests now cover pure write-proposal helper behavior and a headless apply harness for create, append, replace, frontmatter, rename, backup, and audit behavior. There is still no dedicated Obsidian UI/test harness for modal flows.
- The installer and package scripts are local private-alpha workflows, not a public release process.
- Fresh-user zip install and upgrade still need a manual pass by someone following only this guide.

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

After applying all five proposals in Obsidian, verify the copied-vault files, proposal statuses, and audit notes:

```bash
npm run plugin:verify-ui-smoke -- \
  --base-url "https://vault-mcp-connector.vercel.app" \
  --vault-root "/Users/tjt/Documents/Tristan's Personal vault copy" \
  --vault-id "default" \
  --run-id "<run-id>" \
  --mode applied
```
