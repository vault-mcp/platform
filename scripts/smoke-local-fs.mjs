#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessToken = process.env.MCP_ACCESS_TOKEN ?? "local-fs-smoke-access-token";
const syncToken = process.env.MCP_SYNC_TOKEN ?? "local-fs-smoke-sync-token";
const userIntentPhrase = "use local filesystem";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-local-fs-smoke-"));

try {
  const scoped = await runScopedWriteModeSmoke();
  const god = await runGodModeSmoke();
  const expired = await runExpiredAccessSmoke();
  console.log(JSON.stringify({
    ok: true,
    purpose: "local filesystem MCP smoke",
    scoped,
    god,
    expired,
  }, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function runScopedWriteModeSmoke() {
  const readRoot = path.join(tempRoot, "scoped", "read");
  const writeRoot = path.join(tempRoot, "scoped", "write");
  const outsideRoot = path.join(tempRoot, "scoped", "outside");
  const dataDir = path.join(tempRoot, "scoped", "data");
  await fs.mkdir(path.join(readRoot, "20 Projects", "Demo"), { recursive: true });
  await fs.mkdir(writeRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(
    path.join(readRoot, "20 Projects", "Demo", "Project Home.md"),
    "# Demo Project\n\nAlpha searchable phrase.\n",
    "utf8",
  );
  await fs.writeFile(path.join(outsideRoot, "secret.md"), "outside secret", "utf8");

  return withServer({
    port: "38792",
    dataDir,
    args: [
      "--fs-access", "write",
      "--fs-roots", readRoot,
      "--fs-write-roots", writeRoot,
      "--fs-write-operations", "write_file,create_directory,move_path,delete_path",
      "--fs-max-read-bytes", "256",
      "--fs-max-search-results", "5",
      "--fs-max-search-files", "20",
      "--fs-access-ttl-minutes", "30",
    ],
  }, async ({ baseUrl }) => {
    const tools = await mcp(baseUrl, 1, "tools/list", {});
    const toolNames = tools.result.tools.map((tool) => tool.name);
    for (const name of [
      "local_fs_policy",
      "local_list_files",
      "local_read_file",
      "local_find_files",
      "local_search_text",
      "local_write_file",
      "local_create_directory",
      "local_move_path",
      "local_delete_path",
    ]) {
      assert(toolNames.includes(name), `expected ${name} in scoped write mode`);
    }

    const policy = await callTool(baseUrl, 2, "local_fs_policy", {});
    assert(policy.result.structuredContent.mode === "write", "expected scoped mode to be write");
    assert(policy.result.structuredContent.read_roots.includes(readRoot), "expected scoped read root");
    assert(policy.result.structuredContent.write_roots.includes(writeRoot), "expected scoped write root");
    assert(policy.result.structuredContent.max_search_results === 5, "expected max search results cap");
    assert(policy.result.structuredContent.max_search_files === 20, "expected max search files cap");
    assert(typeof policy.result.structuredContent.expires_at === "string", "expected scoped access expiry timestamp");
    assert(policy.result.structuredContent.expired === false, "expected scoped access to be active");
    assert(policy.result.structuredContent.require_user_intent === true, "expected scoped access to require user intent");
    assert(policy.result.structuredContent.user_intent_phrase === userIntentPhrase, "expected default user intent phrase");

    const missingIntent = await mcp(baseUrl, 14, "tools/call", {
      name: "local_read_file",
      arguments: { path: path.join(readRoot, "20 Projects", "Demo", "Project Home.md") },
    });
    assert(missingIntent.result.isError === true, "expected local filesystem read without user_intent to be denied");

    const list = await callTool(baseUrl, 3, "local_list_files", { path: readRoot });
    assert(list.result.structuredContent.entries.some((entry) => entry.name === "20 Projects"), "expected read root listing");

    const found = await callTool(baseUrl, 4, "local_find_files", {
      root: readRoot,
      query: "project home",
      extensions: ["md"],
    });
    assert(found.result.structuredContent.results.some((entry) => entry.path.endsWith("Project Home.md")), "expected local_find_files result");

    const searched = await callTool(baseUrl, 5, "local_search_text", {
      root: readRoot,
      query: "alpha searchable",
      extensions: ["md"],
    });
    assert(searched.result.structuredContent.matches.some((entry) => entry.line === 3), "expected local_search_text match");

    const read = await callTool(baseUrl, 6, "local_read_file", {
      path: path.join(readRoot, "20 Projects", "Demo", "Project Home.md"),
    });
    assert(read.result.structuredContent.text.includes("Alpha searchable phrase"), "expected local_read_file text");

    const deniedRead = await callTool(baseUrl, 7, "local_read_file", {
      path: path.join(outsideRoot, "secret.md"),
    });
    assert(deniedRead.result.isError === true, "expected outside read to be denied");

    const writtenPath = path.join(writeRoot, "generated", "note.md");
    const write = await callTool(baseUrl, 8, "local_write_file", {
      path: writtenPath,
      content: "Generated from local filesystem smoke.\n",
      create_dirs: true,
    });
    assert(write.result.structuredContent.path === writtenPath, "expected write path");
    assert((await fs.readFile(writtenPath, "utf8")).includes("Generated from"), "expected written file");

    const directoryPath = path.join(writeRoot, "created-dir");
    await callTool(baseUrl, 9, "local_create_directory", { path: directoryPath });
    assert((await fs.stat(directoryPath)).isDirectory(), "expected created directory");

    const movedPath = path.join(writeRoot, "generated", "renamed.md");
    await callTool(baseUrl, 10, "local_move_path", {
      source_path: writtenPath,
      destination_path: movedPath,
    });
    assert((await fs.readFile(movedPath, "utf8")).includes("Generated from"), "expected moved file");

    const deniedDelete = await callTool(baseUrl, 11, "local_delete_path", {
      path: movedPath,
      confirm: "wrong",
    });
    assert(deniedDelete.result.isError === true, "expected delete without confirmation to be denied");

    await callTool(baseUrl, 12, "local_delete_path", {
      path: movedPath,
      confirm: "delete",
    });
    assert(!(await pathExists(movedPath)), "expected deleted file");

    const deniedWrite = await callTool(baseUrl, 13, "local_write_file", {
      path: path.join(outsideRoot, "blocked.md"),
      content: "blocked",
    });
    assert(deniedWrite.result.isError === true, "expected outside write to be denied");

    return {
      mode: "write",
      read_root: readRoot,
      write_root: writeRoot,
      tools_checked: 9,
    };
  });
}

async function runGodModeSmoke() {
  const godRoot = path.join(tempRoot, "god-target");
  const dataDir = path.join(tempRoot, "god-data");
  const filePath = path.join(godRoot, "deep", "god-note.md");

  return withServer({
    port: "38793",
    dataDir,
    args: [
      "--fs-access", "god",
      "--fs-write-operations", "write_file,create_directory,move_path,delete_path",
      "--fs-max-read-bytes", "512",
      "--fs-max-search-results", "10",
      "--fs-max-search-files", "50",
      "--fs-access-ttl-minutes", "30",
    ],
  }, async ({ baseUrl }) => {
    const policy = await callTool(baseUrl, 101, "local_fs_policy", {});
    assert(policy.result.structuredContent.mode === "god", "expected god mode");
    assert(policy.result.structuredContent.god_mode === true, "expected god_mode true");
    assert(typeof policy.result.structuredContent.expires_at === "string", "expected god access expiry timestamp");
    assert(policy.result.structuredContent.expired === false, "expected god access to be active");

    await callTool(baseUrl, 102, "local_write_file", {
      path: filePath,
      content: "God mode absolute path smoke phrase.\n",
      create_dirs: true,
    });
    const read = await callTool(baseUrl, 103, "local_read_file", { path: filePath });
    assert(read.result.structuredContent.text.includes("absolute path smoke phrase"), "expected god-mode read");

    const search = await callTool(baseUrl, 104, "local_search_text", {
      root: godRoot,
      query: "smoke phrase",
      extensions: ["md"],
    });
    assert(search.result.structuredContent.matches.length === 1, "expected god-mode text search");

    const movedPath = path.join(godRoot, "deep", "god-note-renamed.md");
    await callTool(baseUrl, 105, "local_move_path", {
      source_path: filePath,
      destination_path: movedPath,
    });
    assert(await pathExists(movedPath), "expected god-mode move");

    await callTool(baseUrl, 106, "local_delete_path", {
      path: godRoot,
      recursive: true,
      confirm: "delete recursively",
    });
    assert(!(await pathExists(godRoot)), "expected god-mode recursive delete");

    return {
      mode: "god",
      target_root: godRoot,
      absolute_paths_checked: true,
    };
  });
}

async function runExpiredAccessSmoke() {
  const readRoot = path.join(tempRoot, "expired", "read");
  const dataDir = path.join(tempRoot, "expired", "data");
  const expiredAt = "2000-01-01T00:00:00.000Z";
  await fs.mkdir(readRoot, { recursive: true });
  await fs.writeFile(path.join(readRoot, "expired-note.md"), "Expired session phrase.\n", "utf8");

  return withServer({
    port: "38795",
    dataDir,
    args: [
      "--fs-access", "read",
      "--fs-roots", readRoot,
      "--fs-access-expires-at", expiredAt,
    ],
  }, async ({ baseUrl }) => {
    const tools = await mcp(baseUrl, 201, "tools/list", {});
    const toolNames = tools.result.tools.map((tool) => tool.name);
    assert(toolNames.includes("local_fs_policy"), "expected expired policy tool");
    assert(!toolNames.includes("local_read_file"), "expected expired read tool to be hidden");
    assert(!toolNames.includes("local_search_text"), "expected expired search tool to be hidden");

    const policy = await callTool(baseUrl, 202, "local_fs_policy", {});
    assert(policy.result.structuredContent.mode === "read", "expected expired read mode");
    assert(policy.result.structuredContent.expires_at === expiredAt, "expected expired timestamp");
    assert(policy.result.structuredContent.expired === true, "expected expired flag");

    return {
      mode: "read",
      expired_at: expiredAt,
      policy_only: true,
    };
  });
}

async function withServer({ port, dataDir, args }, fn) {
  await fs.rm(dataDir, { recursive: true, force: true });
  const baseUrl = `http://127.0.0.1:${port}`;
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
    ...args,
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
    await waitForHealth(baseUrl, server, () => serverOutput);
    const health = await json(`${baseUrl}/healthz`);
    assert(health.ok === true, "expected local filesystem smoke server health");
    return await fn({ baseUrl });
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("close", resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function waitForHealth(baseUrl, server, getServerOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`local filesystem smoke server exited early:\n${getServerOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the local server is ready or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local filesystem smoke server did not become healthy:\n${getServerOutput()}`);
}

async function callTool(baseUrl, id, name, args) {
  const argumentsWithIntent = name.startsWith("local_") && name !== "local_fs_policy"
    ? { ...args, user_intent: args.user_intent ?? userIntentPhrase }
    : args;
  return mcp(baseUrl, id, "tools/call", {
    name,
    arguments: argumentsWithIntent,
  });
}

async function mcp(baseUrl, id, method, params) {
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

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
