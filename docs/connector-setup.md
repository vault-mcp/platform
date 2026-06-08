# Connector Setup Notes

## ChatGPT

Current OpenAI guidance says custom MCP apps/connectors are configured from ChatGPT workspace app settings after developer mode is enabled. Provide the MCP endpoint and authentication configuration, then scan tools.

Local test endpoint:

```text
http://127.0.0.1:3333/mcp
```

For production, expose the same endpoint over HTTPS and configure OAuth/OIDC. The MCP server validates access tokens and advertises protected-resource metadata; the OAuth provider issues authorization codes, access tokens, and refresh tokens.

## Claude

Claude custom connectors can use a remote MCP server. Use the deployed HTTPS MCP endpoint and configure authentication for the private service.

## OAuth Metadata

The server exposes protected-resource metadata at:

```text
https://your-domain.example/.well-known/oauth-protected-resource
https://your-domain.example/.well-known/oauth-protected-resource/mcp
```

`401` responses from `/mcp` include a `WWW-Authenticate` header with the metadata URL.

## MCP Inspector

After starting and syncing the local server, use MCP Inspector with:

```bash
npx @modelcontextprotocol/inspector http://127.0.0.1:3333/mcp
```

Set the `Authorization` header to:

```text
Bearer dev-access-token
```

## Notes

- This server exposes only `search` and `fetch`.
- ChatGPT embedded UI is intentionally deferred.
- The local build is suitable for MCP contract testing. Production deployment still requires a real domain, TLS, Postgres, and OAuth provider configuration.

See [acceptance.md](acceptance.md) for the final MCP Inspector, ChatGPT, and Claude acceptance runbook.
