#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { SignJWT } from "jose";

const root = new URL("..", import.meta.url).pathname;
const port = process.env.PORT ?? "3335";
const baseUrl = `http://127.0.0.1:${port}`;
const syncToken = process.env.MCP_SYNC_TOKEN ?? "dev-sync-token";
const issuer = "https://auth.local.test";
const audience = `${baseUrl}/mcp`;
const jwtSecret = "local-oauth-smoke-secret";
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
  "list_vaults",
  "get_vault_status",
  "debug_search",
];

const server = spawn("node", ["apps/server/dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    PUBLIC_BASE_URL: baseUrl,
    MCP_SYNC_TOKEN: syncToken,
    OAUTH_ISSUER: issuer,
    OAUTH_AUDIENCE: audience,
    OAUTH_AUTHORIZATION_SERVER: issuer,
    OAUTH_JWT_SECRET: jwtSecret,
    OAUTH_SCOPES: "vault:read",
    MCP_ACCESS_TOKEN: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForHealth(baseUrl);
  await runSync();

  const accessToken = await new SignJWT({ sub: "local-smoke-user", scope: "vault:read" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(jwtSecret));

  const metadata = await json(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert(metadata.authorization_servers[0] === issuer, "expected local OAuth authorization server metadata");

  const wrongStaticToken = await mcp(99, "tools/list", {}, "not-the-oauth-token", false);
  assert(wrongStaticToken.status === 401, "expected static bearer token to fail in OAuth-only mode");

  await mcpSseProbe(accessToken);

  const tools = await mcp(1, "tools/list", {}, accessToken);
  assert(tools.body.result.tools.map((tool) => tool.name).join(",") === expectedTools.join(","), "expected expanded read-only vault tools");

  const search = await mcp(2, "tools/call", {
    name: "search",
    arguments: { query: "Vault MCP Connector", limit: 1 },
  }, accessToken);
  const first = search.body.result.structuredContent.results[0];
  assert(first?.metadata?.path === "20 Projects/Vault MCP Connector/Project Home.md", "expected Vault MCP Connector project search result");

  const fetched = await mcp(3, "tools/call", {
    name: "fetch",
    arguments: { id: first.id },
  }, accessToken);
  assert(fetched.body.result.structuredContent.title.includes("Vault MCP Connector"), "expected fetched Vault MCP Connector chunk");

  const listed = await mcp(30, "tools/call", {
    name: "list_notes",
    arguments: { scope: "20 Projects/Vault MCP Connector/", limit: 1 },
  }, accessToken);
  assert(listed.body.result.structuredContent.notes[0]?.path === "20 Projects/Vault MCP Connector/Project Home.md", "expected list_notes to find project home");

  const deniedScopeList = await mcp(31, "tools/call", {
    name: "list_notes",
    arguments: { scope: "02 Daily/", limit: 5 },
  }, accessToken);
  assert(deniedScopeList.body.result.structuredContent.notes.length === 0, "expected denied daily scope to be unavailable");

  const deniedPath = await mcp(32, "tools/call", {
    name: "fetch_note_by_path",
    arguments: { path: "02 Daily/2026-06-10.md" },
  }, accessToken);
  assert(deniedPath.body.result.isError === true, "expected denied path fetch to fail");

  console.log(JSON.stringify({
    ok: true,
    auth_mode: "oauth-jwt",
    first_result_path: first.metadata.path,
    metadata_resource: metadata.resource,
  }, null, 2));
} finally {
  server.kill("SIGTERM");
}

async function runSync() {
  const { buildVaultIndex } = await import("../packages/core/dist/index.js");
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
  assert(response.ok, `sync failed: ${response.status} ${body}`);
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early:\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy:\n${serverOutput}`);
}

async function mcp(id, method, params, token, expectOk = true) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const text = await response.text();
  if (!expectOk) {
    return { status: response.status, body: text };
  }

  assert(response.ok, `expected ${method} to succeed: ${response.status} ${text}`);
  return { status: response.status, body: JSON.parse(text) };
}

async function mcpSseProbe(token) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
