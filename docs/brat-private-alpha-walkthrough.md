# BRAT Private Alpha Walkthrough

This walkthrough is the human evidence gate for installing Vault MCP through
BRAT. Use a copied or disposable vault. Do not use a live vault for this gate.

## What This Proves

This gate proves the parts that scripts cannot fully prove:

- BRAT can see the `vault-mcp/platform` beta plugin entry.
- Obsidian can enable `Vault MCP` after the BRAT install or update flow.
- The plugin settings page opens in Obsidian.
- The readiness checklist, connection preflight, index preview, and sync summary
  are understandable in the actual app.
- The installed plugin files still match the GitHub `0.1.0` BRAT release
  assets after the UI flow.

Automated release, copied-vault config, and installed-file checks must pass
before the screenshots are considered meaningful.

## Before Opening Obsidian

Run these from the repository root:

```bash
npm run plugin:brat:verify-github
npm run plugin:brat:check-copy -- --check-github-release
npm run plugin:brat:verify-copy-install
```

Expected result: each command prints `ok: true`.

If BRAT is not enabled or the repo is not configured in the copied vault, run:

```bash
npm run plugin:brat:check-copy -- --enable-brat --add-repo --check-github-release
```

Then reopen or reload the copied vault in Obsidian.

## Evidence Folder

Use this folder for local evidence:

```text
dist/brat/ui-evidence/
```

This folder is generated local evidence. It is not a source artifact and should
not contain tokens, passwords, or screenshots of secret values.

## Screenshots To Capture

Capture these screenshots after masking or avoiding token fields:

- `brat-repo-config.png`: BRAT shows `vault-mcp/platform` in its beta plugin
  list or update flow.
- `brat-install-update.png`: BRAT install/update flow for Vault MCP has
  completed or reports the plugin is current.
- `community-plugin-enabled.png`: Obsidian Community plugins shows `Vault MCP`
  enabled.
- `vault-mcp-readiness.png`: Vault MCP settings or dashboard shows the safety
  disclosure and readiness checklist.
- `vault-mcp-check-connection.png`: `Check connection` has succeeded or shows
  a clearly actionable copied-vault failure.
- `vault-mcp-preview-index.png`: `Preview index` shows allowed, denied,
  review-required, or redaction counts.
- `vault-mcp-sync-summary.png`: a copied-vault sync summary is visible after
  syncing approved context.

Do not capture:

- GitHub tokens.
- Sync tokens.
- OAuth passwords.
- Full private note content.
- The live vault.

## Evidence Report

Create `dist/brat/ui-evidence/report.json` with this shape:

```json
{
  "releaseTag": "0.1.0",
  "repo": "vault-mcp/platform",
  "vaultKind": "copied",
  "vaultRoot": "/Users/tjt/Documents/Tristan's Personal vault copy",
  "commands": {
    "plugin:brat:verify-github": true,
    "plugin:brat:check-copy": true,
    "plugin:brat:verify-copy-install": true
  },
  "screenshots": {
    "brat-repo-config": "brat-repo-config.png",
    "brat-install-update": "brat-install-update.png",
    "community-plugin-enabled": "community-plugin-enabled.png",
    "vault-mcp-readiness": "vault-mcp-readiness.png",
    "vault-mcp-check-connection": "vault-mcp-check-connection.png",
    "vault-mcp-preview-index": "vault-mcp-preview-index.png",
    "vault-mcp-sync-summary": "vault-mcp-sync-summary.png"
  },
  "notes": [
    "No token fields were visible in screenshots.",
    "Testing used the copied vault only."
  ]
}
```

Then run:

```bash
npm run plugin:brat:verify-ui-evidence
```

Expected result: `ok: true`.

## Passing Criteria

This gate passes only when all of these are true:

- GitHub BRAT release verification passes.
- Copied-vault BRAT config verification passes.
- Copied-vault installed-file verification passes.
- All seven screenshots exist and are readable.
- The evidence report says copied or disposable vault, not live vault.
- No report field contains token-like values.
- `npm run plugin:brat:verify-ui-evidence` prints `ok: true`.

After this passes, update the live project notes with the date, release tag,
commit, evidence folder, and any remaining limitations.
