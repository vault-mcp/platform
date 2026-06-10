#!/usr/bin/env node
import process from "node:process";

const baseUrl = required("SMOKE_BASE_URL").replace(/\/$/, "");
const accessToken = process.env.SMOKE_ACCESS_TOKEN ?? process.env.MCP_ACCESS_TOKEN;
assert(accessToken, "SMOKE_ACCESS_TOKEN or MCP_ACCESS_TOKEN is required");
const syncToken = process.env.MCP_SYNC_TOKEN;
const vaultRoot = process.env.VAULT_ROOT ?? "/Users/tjt/Documents/Tristan's Personal vault copy";
const vaultName = process.env.VAULT_NAME ?? "Tristan's Personal vault copy";
const expectedTools = [
  "search",
  "search_notes",
  "search_sections",
  "list_notes",
  "recent_notes",
  "active_projects",
  "fetch",
  "fetch_note_by_path",
  "get_index_status",
  "debug_search",
];

if (syncToken) {
  await runSync();
}

const health = await json(`${baseUrl}/healthz`);
if (syncToken) {
  assert(health.document_count > 0, "expected synced documents after remote sync");
}

const metadata = await json(`${baseUrl}/.well-known/oauth-protected-resource`);
assert(metadata.resource === `${baseUrl}/mcp`, "expected metadata resource to match /mcp endpoint");
if (process.env.SMOKE_EXPECT_OAUTH === "true") {
  assert(metadata.authorization_servers?.length > 0, "expected OAuth authorization server metadata");
}

const noAuth = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
  },
  body: "{}",
});
assert(noAuth.status === 401, "expected unauthenticated /mcp to return 401");
assert(noAuth.headers.get("www-authenticate")?.includes("resource_metadata="), "expected WWW-Authenticate resource metadata");

await mcpSseProbe();

const tools = await mcp(1, "tools/list", {});
assert(tools.result.tools.map((tool) => tool.name).join(",") === expectedTools.join(","), "expected expanded read-only vault tools");

const search = await mcp(2, "tools/call", {
  name: "search",
  arguments: { query: "Vault MCP Connector", limit: 1 },
});
const first = search.result.structuredContent.results[0];
assert(first?.metadata?.path === "20 Projects/Vault MCP Connector/Project Home.md", "expected Vault MCP Connector project search result");

const fetched = await mcp(3, "tools/call", {
  name: "fetch",
  arguments: { id: first.id },
});
assert(fetched.result.structuredContent.title.includes("Vault MCP Connector"), "expected fetched Vault MCP Connector chunk");

const listed = await mcp(30, "tools/call", {
  name: "list_notes",
  arguments: { scope: "20 Projects/Vault MCP Connector/", limit: 1 },
});
assert(listed.result.structuredContent.notes[0]?.path === "20 Projects/Vault MCP Connector/Project Home.md", "expected list_notes to find project home");

const fetchedByPath = await mcp(31, "tools/call", {
  name: "fetch_note_by_path",
  arguments: { path: "20 Projects/Vault MCP Connector/Project Home.md" },
});
assert(fetchedByPath.result.structuredContent.obsidian_uri?.startsWith("obsidian://open"), "expected path fetch to include obsidian_uri");

const guessed = await mcp(4, "tools/call", {
  name: "fetch",
  arguments: { id: "guessed-denied-id" },
});
assert(guessed.result.isError === true, "expected guessed denied id to fail");

console.log(JSON.stringify({
  ok: true,
  auth_token_source: process.env.SMOKE_ACCESS_TOKEN ? "SMOKE_ACCESS_TOKEN" : "MCP_ACCESS_TOKEN",
  document_count: health.document_count,
  first_result_path: first.metadata.path,
  metadata_resource: metadata.resource,
}, null, 2));

async function runSync() {
  const { buildVaultIndex } = await import("../packages/vault-core/dist/index.js");
  const index = await buildVaultIndex({
    vaultRoot,
    vaultName,
    publicBaseUrl: baseUrl,
  });

  const response = await fetch(`${baseUrl}/admin/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documents: index.documents,
      generated_at: index.generated_at,
      stats: index.stats,
    }),
  });

  const body = await response.text();
  assert(response.ok, `remote sync failed: ${response.status} ${body}`);
}

async function mcp(id, method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const body = await response.text();
  assert(response.ok, `expected ${method} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function mcpSseProbe() {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`expected GET /mcp SSE probe to succeed: ${response.status} ${await response.text()}`);
  }
  assert(response.headers.get("content-type")?.includes("text/event-stream"), "expected GET /mcp to return an SSE content type");
  controller.abort();
  void response.body?.cancel().catch(() => undefined);
}

async function json(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

function required(name) {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
