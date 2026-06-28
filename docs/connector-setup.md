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

- This server exposes read-only discovery and fetch tools: `search`, `search_notes`, `search_sections`, `list_notes`, `recent_notes`, `active_projects`, `fetch`, `fetch_note_by_path`, `get_index_status`, and `debug_search`.
- Search, list, fetch, status, and diagnostics tools now return ChatGPT-friendly text summaries in addition to structured JSON.
- High-value tools advertise the `ui://vault-mcp/results-v2.html` output template through `_meta.ui.resourceUri` and the ChatGPT-compatible `openai/outputTemplate` field. Clients that support MCP Apps-style UI resources can render that `text/html;profile=mcp-app` template as compact cards for search results, note lists, fetched notes, vault lists, vault status, diagnostics, errors, and future write proposals. The component also retries briefly for delayed ChatGPT globals so first render is less fragile. Clients that do not support it still receive readable text and `structuredContent`.
- The local build is suitable for MCP contract testing. Production deployment still requires a real domain, TLS, Postgres, and OAuth provider configuration.

See [acceptance.md](acceptance.md) for the final MCP Inspector, ChatGPT, and Claude acceptance runbook.
