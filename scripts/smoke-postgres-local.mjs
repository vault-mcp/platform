#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultVaultRoot = path.join(root, "fixtures", "vault");
const usingFixtureVault = !process.env.VAULT_ROOT;
const databaseUrl = required("POSTGRES_SMOKE_DATABASE_URL");
const port = process.env.PORT ?? "3334";
const baseUrl = `http://127.0.0.1:${port}`;
const accessToken = process.env.MCP_ACCESS_TOKEN ?? "dev-access-token";
const syncToken = process.env.MCP_SYNC_TOKEN ?? "dev-sync-token";
const vaultRoot = process.env.VAULT_ROOT ?? defaultVaultRoot;
const vaultName = process.env.VAULT_NAME ?? (usingFixtureVault ? "Vault MCP fixture vault" : path.basename(vaultRoot));
const expectedProjectPath = usingFixtureVault ? "20 Projects/Test Project/Project Home.md" : "20 Projects/Vault MCP Connector/Project Home.md";
const expectedProjectScope = usingFixtureVault ? "20 Projects/Test Project/" : "20 Projects/Vault MCP Connector/";
const expectedProjectTitle = usingFixtureVault ? "Test Project" : "Vault MCP Connector";
const expectedSearchQuery = usingFixtureVault ? "connector discovery improvements" : "Vault MCP Connector";
const deniedScope = usingFixtureVault ? "Daily Notes/" : "02 Daily/";
const deniedPath = usingFixtureVault ? "Daily Notes/2026-06-10.md" : "02 Daily/2026-06-10.md";
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

const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    PUBLIC_BASE_URL: baseUrl,
    MCP_ACCESS_TOKEN: accessToken,
    MCP_SYNC_TOKEN: syncToken,
    DATABASE_URL: databaseUrl,
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
  await runIndexer();

  const health = await json(`${baseUrl}/healthz`);
  assert(health.document_count > 0, "expected synced Postgres documents");
  assert(health.stats?.denied_markdown > 0, "expected sync stats with denied notes");

  const tools = await mcp(1, "tools/list", {});
  assert(tools.result.tools.map((tool) => tool.name).join(",") === expectedTools.join(","), "expected expanded read-only vault tools");

  const search = await mcp(2, "tools/call", {
    name: "search",
    arguments: { query: expectedSearchQuery, limit: 1 },
  });
  const first = search.result.structuredContent.results[0];
  assert(first?.metadata?.path === expectedProjectPath, `expected project search result at ${expectedProjectPath}`);

  const fetched = await mcp(3, "tools/call", {
    name: "fetch",
    arguments: { id: first.id },
  });
  assert(fetched.result.structuredContent.title.includes(expectedProjectTitle), `expected fetched ${expectedProjectTitle} chunk`);

  const listed = await mcp(30, "tools/call", {
    name: "list_notes",
    arguments: { scope: expectedProjectScope, limit: 1 },
  });
  assert(listed.result.structuredContent.notes[0]?.path === expectedProjectPath, "expected list_notes to find project home");

  const deniedScopeList = await mcp(31, "tools/call", {
    name: "list_notes",
    arguments: { scope: deniedScope, limit: 5 },
  });
  assert(deniedScopeList.result.structuredContent.notes.length === 0, "expected denied daily scope to be unavailable");

  const deniedPathFetch = await mcp(32, "tools/call", {
    name: "fetch_note_by_path",
    arguments: { path: deniedPath },
  });
  assert(deniedPathFetch.result.isError === true, "expected denied path fetch to fail");

  const guessed = await mcp(4, "tools/call", {
    name: "fetch",
    arguments: { id: "guessed-denied-id" },
  });
  assert(guessed.result.isError === true, "expected guessed denied id to fail");

  console.log(JSON.stringify({
    ok: true,
    storage: "postgres",
    document_count: health.document_count,
    first_result_path: first.metadata.path,
  }, null, 2));
} finally {
  server.kill("SIGTERM");
}

async function runIndexer() {
  await run(process.execPath, [
    "apps/cli/dist/index.js",
    "--vault",
    vaultRoot,
    "--vault-name",
    vaultName,
    "--public-base-url",
    baseUrl,
    "--out",
    "data/index.json",
    "--server",
    baseUrl,
    "--sync-token",
    syncToken,
  ]);
}

async function waitForHealth(url) {
  const deadline = Date.now() + 20_000;
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

async function json(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert(code === 0, `${command} ${args.join(" ")} failed:\n${output}`);
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
