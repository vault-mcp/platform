# PRD

## Goal

Build a private, portable, read-only MCP connector that lets approved AI clients discover, search, diagnose, and fetch selected Obsidian vault context.

## V1 Scope

- Local indexer scans a vault snapshot or live vault path.
- Source policy filters notes before anything is synced.
- Only selected technical/reference subfolders under `40 Reference/` are indexed in V1; unselected reference folders are denied by default.
- Remote server stores a derived index in local JSON for development or Postgres full-text search for production, then exposes read-only MCP discovery, search, diagnostics, and fetch tools.
- Responses include citation URLs and Obsidian URIs.
- No vault writes, note editing, task creation, or broad filesystem access.

## Interfaces

- `POST /mcp`: Streamable HTTP JSON-RPC endpoint.
- `GET /mcp`: authenticated Streamable HTTP SSE endpoint.
- `GET /healthz`: service version, storage/database status, migration ids, vault count, last sync time, and index count.
- `POST /admin/sync`: bearer-token-protected index replacement.
- `GET /notes/:id`: bearer-token-protected citation payload.

## MCP Tools

`search({ query, mode?, limit?, scope?, tags?, status?, type? })`

Returns:

```json
{
  "results": [
    {
      "id": "stable-id",
      "title": "Note title",
      "url": "https://private.example/notes/stable-id",
      "text_snippet": "matching text",
      "metadata": {}
    }
  ]
}
```

`list_notes({ scope?, tag?, status?, type?, limit?, cursor? })`

Returns indexed/readable note summaries and an optional cursor.

`fetch({ id })`

Returns:

```json
{
  "id": "stable-id",
  "title": "Note title",
  "text": "chunk text",
  "url": "https://private.example/notes/stable-id",
  "metadata": {}
}
```

Additional read-only tools:

- `search_notes`
- `search_sections`
- `recent_notes`
- `active_projects`
- `fetch_note_by_path`
- `get_index_status`
- `debug_search`

## Acceptance

- The copied vault can be indexed without touching the live vault.
- Allowed project/reference notes are searchable and fetchable.
- Denied notes do not appear in search.
- Guessed IDs for denied notes do not fetch anything.
- `/mcp` requires the access token.
- `GET /mcp` returns an authenticated SSE stream when the client accepts `text/event-stream`.
- `/admin/sync` requires the sync token.
- Build and test suites pass.
