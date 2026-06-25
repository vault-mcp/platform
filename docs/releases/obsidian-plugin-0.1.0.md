# Vault MCP Obsidian Plugin 0.1.0

Private-alpha release for copied-vault and disposable-vault testing.

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

- Use copied or disposable vaults first. Do not point private-alpha testing at a live vault until the copied-vault UI smoke gate passes.
- `patch_note` proposals are not accepted in this release.
- BRAT and Obsidian community-plugin release paths are not enabled yet.
- Real Obsidian enablement and full user click-through still need manual verification.
- Public docs still need demo-vault data before wider release.

## Verification Commands

```bash
npm run plugin:package
npm run plugin:verify-package
npm run build
npm run check:api
npm test
```

## Upgrade Notes

This is the first private-alpha package. For later upgrades, preserve Obsidian's plugin `data.json` unless release notes explicitly say the settings shape changed.
