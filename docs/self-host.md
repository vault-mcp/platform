# Self-Host Vault MCP

This guide is the clean private-alpha path for running your own Vault MCP server.
It assumes you are comfortable copying commands into a terminal, but it does not
assume you have read the source code.

## What You Are Deploying

Vault MCP has two parts:

- **Server:** a public HTTPS MCP/OAuth/API service that ChatGPT, Claude, Codex,
  and other MCP clients connect to.
- **Obsidian plugin or CLI sync client:** a local tool that scans an Obsidian
  vault, applies indexing rules, and syncs an approved derived index to the
  server.

The server does not read your filesystem. It only serves what the sync client
has sent to it.

## Recommended Private-Alpha Stack

Use this path first:

- Vercel for the Node server.
- Neon Postgres for storage.
- The built-in self-hosted OAuth flow for MCP client login.
- The Obsidian plugin or CLI for syncing a copied/test vault first.

Docker/container hosting is also supported, but Vercel + Neon is the path with
the most verification today.

## Prerequisites

Install:

- Node.js 24 or newer.
- npm.
- Git.
- Vercel CLI if deploying to Vercel: `npm i -g vercel`.
- A Postgres database URL. Neon works well for the private-alpha path.

Clone and install:

```bash
git clone https://github.com/vault-mcp/platform.git vault-mcp
cd vault-mcp
npm ci
```

## Environment Variables

Create long random values before deploying:

```bash
openssl rand -base64 32
```

Required server variables:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public HTTPS origin of your server, for example `https://vault-mcp.example.com`. |
| `DATABASE_URL` | Postgres connection string. |
| `MCP_SYNC_TOKEN` | Admin token used by the plugin or CLI to sync vault data. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the server. |
| `OAUTH_ISSUER` | OAuth issuer. For built-in OAuth, same as `PUBLIC_BASE_URL`. |
| `OAUTH_AUDIENCE` | MCP audience URL, usually `$PUBLIC_BASE_URL/mcp`. |
| `OAUTH_AUTHORIZATION_SERVER` | OAuth authorization server. For built-in OAuth, same as `PUBLIC_BASE_URL`. |
| `OAUTH_JWT_SECRET` | Long random HMAC secret for built-in OAuth access tokens. |
| `OAUTH_AUTH_PASSWORD` | Human password entered during MCP client authorization. |
| `OAUTH_SCOPES` | Usually `vault:read`. |

Recommended origin list for common clients:

```bash
ALLOWED_ORIGINS="https://chatgpt.com,https://chat.openai.com,https://claude.ai,http://localhost:6274,http://127.0.0.1:6274"
```

`MCP_ACCESS_TOKEN` is only for temporary local or Inspector testing. Do not use
it as the final production authentication model.

## Step 1 - Verify The Local Build

```bash
npm run build
npm run check:api
npm test
```

Expected result:

- build succeeds
- API typecheck succeeds
- tests pass

## Step 2 - Run Database Migrations

Run migrations before first deploy and before upgrades:

```bash
DATABASE_URL="postgres://user:password@host:5432/vault_mcp" npm run db:migrate
```

Expected result:

```json
{
  "ok": true,
  "total_migrations": 1,
  "pending": []
}
```

The server also runs the same migration runner on startup as a safety net, but
you should treat `npm run db:migrate` as the explicit deploy/upgrade step.

To prove a fresh database boot without touching existing Vault MCP tables, run
the isolated schema smoke:

```bash
POSTGRES_SMOKE_DATABASE_URL="postgres://user:password@host:5432/vault_mcp" \
npm run smoke:postgres:fresh
```

This creates a temporary schema, runs migrations from empty state, syncs one
fixture document, checks Postgres health, and drops the schema.

## Step 3 - Deploy To Vercel

Log in and link the project:

```bash
vercel login
vercel link
```

Set production environment variables:

```bash
vercel env add PUBLIC_BASE_URL production
vercel env add DATABASE_URL production
vercel env add MCP_SYNC_TOKEN production
vercel env add ALLOWED_ORIGINS production
vercel env add OAUTH_ISSUER production
vercel env add OAUTH_AUDIENCE production
vercel env add OAUTH_AUTHORIZATION_SERVER production
vercel env add OAUTH_JWT_SECRET production
vercel env add OAUTH_AUTH_PASSWORD production
vercel env add OAUTH_SCOPES production
```

For built-in OAuth, use values like:

```bash
PUBLIC_BASE_URL=https://vault-mcp.example.com
OAUTH_ISSUER=https://vault-mcp.example.com
OAUTH_AUDIENCE=https://vault-mcp.example.com/mcp
OAUTH_AUTHORIZATION_SERVER=https://vault-mcp.example.com
OAUTH_SCOPES=vault:read
```

Deploy:

```bash
vercel deploy --prod
```

After deployment, confirm:

```bash
curl https://vault-mcp.example.com/healthz
curl https://vault-mcp.example.com/.well-known/oauth-protected-resource
curl https://vault-mcp.example.com/.well-known/oauth-authorization-server
```

`/healthz` should return HTTP `200` with:

- `ok: true`
- `service.version`
- `storage.kind`
- `storage.ok`
- `storage.migrations` when Postgres is active
- `document_count`
- `vault_count`
- `last_sync_at`

If storage is unreachable, `/healthz` returns HTTP `503` with `ok: false` and a
safe storage error message.

## Step 4 - Sync A Test Vault

Start with a copied or disposable vault. Do not start with a live vault.

Using the CLI:

```bash
MCP_SYNC_TOKEN="your-sync-token" npm run index -- \
  --vault "/absolute/path/to/test-vault" \
  --vault-name "Test Vault" \
  --public-base-url "https://vault-mcp.example.com" \
  --server "https://vault-mcp.example.com"
```

Using the Obsidian plugin:

1. Install the private-alpha plugin package from `dist/obsidian-plugin/`.
2. Open plugin settings.
3. Set Server URL to `https://vault-mcp.example.com`.
4. Paste `MCP_SYNC_TOKEN`.
5. Keep Vault id as `default` unless you are testing multiple vaults.
6. Run **Preview index**.
7. Review denied and review-required notes.
8. Run **Sync now** only after the preview looks right.

## Step 5 - Run Remote Smoke Tests

Built-in OAuth full flow:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_OAUTH_PASSWORD="your-oauth-password" \
MCP_SYNC_TOKEN="your-sync-token" \
npm run smoke:oauth-flow
```

Add multi-vault isolation verification:

```bash
SMOKE_BASE_URL="https://vault-mcp.example.com" \
SMOKE_OAUTH_PASSWORD="your-oauth-password" \
MCP_SYNC_TOKEN="your-sync-token" \
SMOKE_MULTI_VAULT=true \
npm run smoke:oauth-flow
```

Passing output should include:

- `"ok": true`
- `"oauth_flow": "authorization_code_pkce"`
- `"refresh": true`
- `"replay_protection": true`
- `"multi_vault": true` when `SMOKE_MULTI_VAULT=true`

## Step 5.5 - Record Self-Host Evidence

The smoke tests prove behavior, but a publishable fresh self-host gate needs a
single non-secret evidence report. Before starting a fresh Vercel + Neon pass,
prepare the report:

```bash
npm run selfhost:prepare -- --base-url "https://vault-mcp.example.com"
```

This writes:

```text
dist/selfhost/selfhost-report.json
```

Fill it with non-secret evidence references for local build/test output,
database migration and fresh Postgres smoke output, Vercel deployment/check
URLs, `/healthz` and OAuth metadata checks, copied/disposable-vault sync,
remote OAuth smoke, multi-vault smoke, and client handoff values. Do not paste
`DATABASE_URL`, `MCP_SYNC_TOKEN`, OAuth passwords, bearer values, GitHub tokens,
or private note bodies into the report.

Check progress:

```bash
npm run selfhost:status
```

Final strict gate:

```bash
npm run selfhost:verify
```

The verifier requires a true fresh self-host pass. It intentionally fails if the
report marks the run as an existing-project rerun only.

## Step 6 - Connect MCP Clients

Use this MCP endpoint:

```text
https://vault-mcp.example.com/mcp
```

For built-in OAuth, the authorization server is the same origin:

```text
https://vault-mcp.example.com
```

During authorization, enter the password from `OAUTH_AUTH_PASSWORD`.

After connecting, verify:

- the client lists only read-only vault tools
- `list_vaults` returns the synced vault
- `search` finds known test-vault content
- `fetch` can fetch a returned id
- denied or guessed paths fail

## Container Hosting

For a container host:

```bash
docker build -t vault-mcp .
docker run --rm -p 3333:3333 --env-file .env vault-mcp
```

Your `.env` file should contain the same variables listed above. Set:

```bash
HOST=0.0.0.0
PORT=3333
PUBLIC_BASE_URL=https://your-public-domain.example
```

Run `npm run db:migrate` against the same `DATABASE_URL` before starting the
container for the first time.

## Upgrade Checklist

Before upgrading:

1. Read release notes.
2. Back up Postgres or confirm you can rebuild the derived index.
3. Run `npm ci`.
4. Run `npm run db:migrate`.
5. Run `npm run smoke:postgres:fresh` when a Postgres URL is available.
6. Run `npm run build`.
7. Deploy.
8. Run `npm run smoke:oauth-flow`.
9. Re-sync from the plugin or CLI if the release notes say index format changed.

## Recovery

If a deployment fails:

- Roll back to the previous Vercel deployment.
- Confirm `/healthz` on the previous deployment.
- Re-run smoke against the production alias.

If a vault sync is wrong:

- Fix plugin/CLI index rules locally.
- Run preview again.
- Re-sync the vault.
- If needed, delete a vault from server storage with the admin delete endpoint
  and sync again.

If credentials leak:

- Rotate `MCP_SYNC_TOKEN`.
- Rotate `OAUTH_JWT_SECRET`.
- Rotate `OAUTH_AUTH_PASSWORD`.
- Reconnect MCP clients.

## Known Private-Alpha Limits

- Use a copied/test vault first.
- Public docs still need demo vault data and screenshots.
- Write support is proposal-first. The server must not directly edit a vault.
- `direct_apply` is not ready for broad use.
- `patch_note` proposals are intentionally excluded until a safe parser/apply
  path exists.
- Obsidian community-plugin publishing is not ready yet.
