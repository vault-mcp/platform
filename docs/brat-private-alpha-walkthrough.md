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

Run this from the repository root:

```bash
npm run plugin:brat:ready
```

Expected result: the command verifies the GitHub `0.1.0` release, the copied
vault BRAT config, the copied-vault installed plugin files, and the local UI
evidence folder. When everything except screenshots is ready, it prints
`Status: waiting_for_screenshots` plus the exact screenshot filenames to
capture.

If you need to debug one piece at a time, these are the individual checks:

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

The readiness command prepares the local evidence folder automatically. To
prepare it directly:

```bash
npm run plugin:brat:prepare-ui-evidence
```

That command runs the prerequisite BRAT checks and writes the initial
`report.json` for you. Use `--skip-checks` only when you already ran the checks
and only need to recreate the report scaffold.

To see what remains before the strict verifier can pass:

```bash
npm run plugin:brat:evidence-status
```

Before screenshots are captured, this should report
`status: "waiting_for_screenshots"` and list the exact missing filenames.

By default, evidence goes here:

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

To avoid naming mistakes, use the capture helper from the repository root:

```bash
npm run plugin:brat:capture -- --list
npm run plugin:brat:capture -- --key brat-repo-config
```

On macOS, the default `interactive` mode lets you drag a safe region, or press
Space and click the Obsidian window. Use `--mode window` when the whole Obsidian
window is safe to capture. After each screenshot, inspect it before sharing or
using it as evidence.

After inspecting a screenshot, mark it reviewed:

```bash
npm run plugin:brat:review -- --key brat-repo-config --reviewer "Tristan"
```

Only mark a screenshot reviewed when it shows the required UI state, uses copied
or otherwise safe vault context, and does not expose GitHub tokens, sync tokens,
OAuth passwords, or private note bodies.

Do not capture:

- GitHub tokens.
- Sync tokens.
- OAuth passwords.
- Full private note content.
- The live vault.

## Evidence Report

`npm run plugin:brat:prepare-ui-evidence` creates
`dist/brat/ui-evidence/report.json` with this shape. The screenshot review
section is abbreviated here; the generated report includes every screenshot key.

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
  "screenshotReview": {
    "brat-repo-config": {
      "matchesRequiredScreen": false,
      "copiedVaultOrSafeContext": false,
      "noSecretsVisible": false,
      "reviewer": "",
      "reviewedAt": "",
      "notes": ""
    }
  },
  "notes": [
    "No token fields were visible in screenshots.",
    "Testing used the copied vault only."
  ]
}
```

Then run:

```bash
npm run plugin:brat:evidence-status
npm run plugin:brat:verify-ui-evidence
```

Expected result: `ok: true`. The strict verifier checks that every screenshot is
a readable PNG or JPEG, has useful dimensions, is not just a tiny placeholder,
and is unique from the other evidence screenshots.

## Passing Criteria

This gate passes only when all of these are true:

- GitHub BRAT release verification passes.
- Copied-vault BRAT config verification passes.
- Copied-vault installed-file verification passes.
- All seven screenshots exist and are readable.
- Screenshots are not duplicate placeholder files.
- Every screenshot is marked reviewed after human inspection.
- The evidence report says copied or disposable vault, not live vault.
- No report field contains token-like values.
- `npm run plugin:brat:verify-ui-evidence` prints `ok: true`.

After this passes, update the live project notes with the date, release tag,
commit, evidence folder, and any remaining limitations.
