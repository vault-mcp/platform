#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "38794";
const baseUrl = `http://127.0.0.1:${port}`;
const accessToken = process.env.MCP_ACCESS_TOKEN ?? "local-inspector-smoke-access-token";
const syncToken = process.env.MCP_SYNC_TOKEN ?? "local-inspector-smoke-sync-token";
const inspectorOrigins = ["http://localhost:6274", "http://127.0.0.1:6274"];
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-local-inspector-smoke-"));
const readRoot = path.join(tempRoot, "read");
const writeRoot = path.join(tempRoot, "write");
const dataDir = path.join(tempRoot, "data");

await fs.mkdir(readRoot, { recursive: true });
await fs.mkdir(writeRoot, { recursive: true });
await fs.writeFile(path.join(readRoot, "inspector-note.md"), "# Inspector Note\n\nLocal inspector origin phrase.\n", "utf8");

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
  "--fs-access",
  "write",
  "--fs-roots",
  readRoot,
  "--fs-write-roots",
  writeRoot,
  "--fs-write-operations",
  "write_file,create_directory,move_path,delete_path",
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
  for (const origin of inspectorOrigins) {
    await expectAllowedPreflight(origin);
  }

  await expectForbiddenOrigin();
  await expectSseFromInspectorOrigin(inspectorOrigins[0]);

  const tools = await mcp(1, "tools/list", {}, inspectorOrigins[0]);
  const toolNames = tools.result.tools.map((tool) => tool.name);
  for (const name of ["local_fs_policy", "local_read_file", "local_search_text", "local_write_file"]) {
    assert(toolNames.includes(name), `expected ${name} for local Inspector acceptance`);
  }

  const policy = await callTool(2, "local_fs_policy", {}, inspectorOrigins[0]);
  assert(policy.result.structuredContent.mode === "write", "expected Inspector smoke write policy");

  const search = await callTool(3, "local_search_text", {
    root: readRoot,
    query: "inspector origin",
    extensions: ["md"],
  }, inspectorOrigins[0]);
  assert(search.result.structuredContent.matches.length === 1, "expected Inspector-origin text search");

  const writtenPath = path.join(writeRoot, "inspector-output.md");
  await callTool(4, "local_write_file", {
    path: writtenPath,
    content: "Written through Inspector-origin MCP smoke.\n",
  }, inspectorOrigins[0]);
  assert((await fs.readFile(writtenPath, "utf8")).includes("Inspector-origin"), "expected Inspector-origin write");

  console.log(JSON.stringify({
    ok: true,
    purpose: "local MCP Inspector origin smoke",
    endpoint: `${baseUrl}/mcp`,
    inspectorOrigins,
    verified: [
      "localhost and 127.0.0.1 MCP Inspector origins pass CORS preflight",
      "disallowed browser origin is rejected",
      "authenticated SSE probe works from Inspector origin",
      "authenticated tools/list and local filesystem tools work from Inspector origin",
      "scoped local text search and write work through Inspector-origin MCP calls",
    ],
  }, null, 2));
} finally {
  await stopServer();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function expectAllowedPreflight(origin) {
  const response = await fetch(`${baseUrl}/mcp`, withTimeout({
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Authorization,Content-Type,Accept,MCP-Protocol-Version",
    },
  }));
  assert(response.status === 204, `expected allowed Inspector preflight for ${origin}`);
  assert(response.headers.get("access-control-allow-origin") === origin, `expected CORS allow origin ${origin}`);
}

async function expectForbiddenOrigin() {
  const response = await fetch(`${baseUrl}/mcp`, withTimeout({
    method: "POST",
    headers: {
      Origin: "http://forbidden.localhost:6274",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 900, method: "tools/list", params: {} }),
  }));
  const body = await response.text();
  assert(response.status === 403, `expected forbidden origin to return 403, got ${response.status} ${body}`);
  assert(body.includes("forbidden_origin"), "expected forbidden_origin body");
}

async function expectSseFromInspectorOrigin(origin) {
  await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/mcp`, {
      method: "GET",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
      },
    }, (response) => {
      const contentType = response.headers["content-type"] ?? "";
      try {
        assert(response.statusCode === 200, `expected Inspector-origin SSE probe to return 200, got ${response.statusCode}`);
        assert(String(contentType).includes("text/event-stream"), "expected SSE content type");
        request.destroy();
        resolve();
      } catch (error) {
        request.destroy();
        reject(error);
      }
    });
    request.setTimeout(5_000, () => {
      request.destroy(new Error("Timed out waiting for Inspector-origin SSE headers."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function callTool(id, name, args, origin) {
  return mcp(id, "tools/call", {
    name,
    arguments: args,
  }, origin);
}

async function mcp(id, method, params, origin) {
  const response = await fetch(`${baseUrl}/mcp`, withTimeout({
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }));
  const body = await response.text();
  assert(response.ok, `expected ${method} from Inspector origin to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`local Inspector smoke server exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, withTimeout({}));
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the local server is ready or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local Inspector smoke server did not become healthy:\n${serverOutput}`);
}

function withTimeout(options, ms = 5_000) {
  return {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(ms),
  };
}

async function stopServer() {
  if (server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  const closed = await Promise.race([
    new Promise((resolve) => server.once("close", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!closed && server.exitCode === null) {
    server.kill("SIGKILL");
    await new Promise((resolve) => server.once("close", resolve));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
