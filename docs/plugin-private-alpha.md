# Obsidian Plugin Private Alpha

This guide covers the current V2 plugin slice. It is meant for local development and private-alpha testing against a copied vault, not for public release yet.

## What Works Now

- Installs the built plugin into an Obsidian vault copy.
- Lets the user configure the remote Vault MCP server URL, sync token, vault id, index mode, write mode, include rules, exclude rules, and manual allow rules.
- Previews index decisions before sync.
- Shows why each note is allowed, denied, or held for review.
- Syncs allowed Markdown chunks to the server through the per-vault sync endpoint.
- Checks server-side write proposals, but does not apply writes yet.

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

Use `Review queue` to inspect notes that matched sensitive metadata. For this slice, approval is done by adding exact paths or prefixes in settings. One-click approval controls are still a next step.

## Current Publishability Gaps

- The plugin is not packaged for the Obsidian community plugin process.
- There is no one-click approval button in the review queue yet.
- Write proposals can be listed from the server, but cannot be approved, rejected, or applied in Obsidian yet.
- Plugin tests are still mostly covered through TypeScript/build checks instead of a dedicated Obsidian test harness.
- The installer is a local development script, not a release artifact.

