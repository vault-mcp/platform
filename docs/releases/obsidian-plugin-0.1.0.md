# Vault MCP Obsidian Plugin 0.1.0

Private-alpha release for copied-vault, disposable-vault, and BRAT testing.

GitHub prerelease:

```text
https://github.com/vault-mcp/platform/releases/tag/0.1.0
```

## What Is Included

- Settings for server URL, sync token, vault id, index mode, write mode, include rules, exclude rules, manual allow rules, and write audit folder.
- Dashboard with safety boundary and configuration readiness checks.
- Connection preflight for server health, storage readiness, migration metadata, and configured-vault status before sync.
- Dry-run index preview for allowed, denied, review-required, and redacted notes.
- Review queue for sensitive notes held by policy.
- Sync of approved Markdown chunks to the configured Vault MCP server.
- Write proposal review for create, append, replace, frontmatter update, and rename operations.
- Local write apply for supported approved proposals after safety checks, with backup and audit notes.

## Safety Defaults

- `review_required` is the default write mode.
- Exclude rules win before include and manual allow rules.
- The server stores a derived index and write proposals; it does not directly edit Obsidian files.
- Local write apply creates backup and audit notes under the configured audit folder.
- `direct_apply` remains experimental and should not be used for normal private-alpha testing.

## Known Limitations

- Use copied or disposable vaults first. Do not point private-alpha testing at a live vault until the private-alpha safety review and release walkthrough gates pass.
- `patch_note` proposals are not accepted in this release.
- BRAT release assets are published on the `0.1.0` GitHub prerelease and can be verified with `npm run plugin:brat:verify-github`; the actual BRAT UI install from a copied vault is still an external gate.
- Obsidian community-plugin submission is not enabled yet.
- Copied-vault Obsidian UI verification passed for create, append, replace, frontmatter, and rename proposals; a broader external-user walkthrough is still open.
- Public docs still need demo-vault data before wider release.

## Verification Commands

```bash
npm run plugin:package
npm run plugin:verify-package
npm run plugin:brat:prepare
npm run plugin:brat:verify
npm run plugin:brat:verify-github
npm run plugin:brat:check-copy -- --check-github-release
npm run plugin:brat:verify-copy-install
npm run plugin:smoke-fresh-install
npm run plugin:smoke-lifecycle
npm run build
npm run check:api
npm test
```

## Upgrade Notes

This is the first private-alpha package. For later upgrades, preserve Obsidian's plugin `data.json` unless release notes explicitly say the settings shape changed.
