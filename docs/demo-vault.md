# Demo Vault

`fixtures/vault/` is the synthetic demo vault for public docs, screenshots, and
policy examples. It is intentionally small and does not contain real user data.

The demo vault has three notes that should be indexed by the default policy:

- `20 Projects/Test Project/Project Home.md`
- `40 Reference/Recipes/Crisp Twilight.md`
- `40 Reference/Self Hosting/Home Server Playbook.md`

It also has two notes that should not be indexed:

- `Credentials/API Keys.md`
- `Daily Notes/2026-06-10.md`

`40 Reference/Recipes/Crisp Twilight.md` intentionally contains
`fixture-secret-value` so the redaction path can be demonstrated without using a
real secret. The indexed text should show `[REDACTED:env-secret]` instead of the
fixture value.

Verify the fixture before using it in public docs or screenshots:

```bash
npm run demo:verify
```

Passing output lists the expected indexed paths, expected denied paths, and the
redaction fixture. Do not replace this fixture with a copied real vault for
public materials.
