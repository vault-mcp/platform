#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "38791";
const baseUrl = `http://127.0.0.1:${port}`;
const accessToken = process.env.MCP_ACCESS_TOKEN ?? "local-smoke-access-token";
const syncToken = process.env.MCP_SYNC_TOKEN ?? "local-smoke-sync-token";
const dataDir = process.env.VAULT_MCP_LOCAL_DATA_DIR
  ? path.resolve(repoRoot, process.env.VAULT_MCP_LOCAL_DATA_DIR)
  : path.join(repoRoot, "dist", "local-server-smoke");
const vaultRoot = path.join(repoRoot, "fixtures", "vault");
const vaultId = "demo-local";

await fs.rm(dataDir, { recursive: true, force: true });

const server = spawn(process.execPath, [
  "scripts/start-local-server.mjs",
  "--port",
  port,
  "--data-dir",
  dataDir,
  "--mcp-token",
  accessToken,
  "--sync-token",
  syncToken,
], {
  cwd: repoRoot,
  env: process.env,
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
  await waitForHealth();
  await runIndexer();

  const health = await json(`${baseUrl}/healthz`);
  assert(health.ok === true, "expected local server health to be ok");
  assert(health.storage?.kind === "json", "expected local server to use JSON storage");
  assert(health.service?.mcp_resource_url === `${baseUrl}/mcp`, "expected local MCP resource URL");
  assert(health.document_count === 3, `expected 3 indexed demo documents, got ${health.document_count}`);

  const vaults = await json(`${baseUrl}/admin/vaults`, {
    Authorization: `Bearer ${syncToken}`,
  });
  assert(vaults.vaults?.[0]?.vault_id === vaultId, "expected synced demo-local vault");
  assert(vaults.vaults?.[0]?.document_count === 3, "expected demo-local vault document count");

  const noAuth = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: "{}",
  });
  assert(noAuth.status === 401, "expected unauthenticated local MCP request to return 401");

  const tools = await mcp(1, "tools/list", {});
  const toolNames = tools.result.tools.map((tool) => tool.name);
  assert(toolNames.includes("search_notes"), "expected search_notes tool");
  assert(toolNames.includes("fetch_note_by_path"), "expected fetch_note_by_path tool");
  assert(toolNames.includes("get_vault_status"), "expected get_vault_status tool");
  assert(!toolNames.some((name) => name.startsWith("local_")), "expected local filesystem tools to stay disabled by default");

  const search = await mcp(2, "tools/call", {
    name: "search",
    arguments: { query: "connector discovery improvements", vault_id: vaultId, limit: 1 },
  });
  const first = search.result.structuredContent.results[0];
  assert(first?.metadata?.path === "20 Projects/Test Project/Project Home.md", "expected demo project search result");

  const fetched = await mcp(3, "tools/call", {
    name: "fetch",
    arguments: { id: first.id, vault_id: vaultId },
  });
  assert(fetched.result.structuredContent.text.includes("connector discovery improvements"), "expected fetched demo project text");

  const deniedPath = await mcp(4, "tools/call", {
    name: "fetch_note_by_path",
    arguments: { path: "Daily Notes/2026-06-10.md", vault_id: vaultId },
  });
  assert(deniedPath.result.isError === true, "expected denied daily fixture path to stay unavailable");

  const status = await mcp(5, "tools/call", {
    name: "get_vault_status",
    arguments: { vault_id: vaultId },
  });
  assert(status.result.structuredContent.document_count === 3, "expected local vault status document count");
  assert(status.result.structuredContent.stats === null, "expected scoped local vault status to omit global stats");

  const indexStat = await fs.stat(path.join(dataDir, "index.json"));
  assert(indexStat.size > 0, "expected local index JSON to be written");

  console.log(JSON.stringify({
    ok: true,
    purpose: "local desktop server smoke",
    endpoint: `${baseUrl}/mcp`,
    vault_id: vaultId,
    document_count: health.document_count,
    storage: health.storage.kind,
    data_dir: dataDir,
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("close", resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}

async function runIndexer() {
  await run(process.execPath, [
    "apps/cli/dist/index.js",
    "--vault",
    vaultRoot,
    "--vault-name",
    "Vault MCP Demo",
    "--vault-id",
    vaultId,
    "--public-base-url",
    baseUrl,
    "--server",
    baseUrl,
    "--sync-token",
    syncToken,
  ]);
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`local server exited early:\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local server did not become healthy:\n${serverOutput}`);
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

async function json(url, headers = {}) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
