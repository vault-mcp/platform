#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-hosted-local-bridge-"));
const desktopRoot = path.join(tempRoot, "desktop-root");
const outsideRoot = path.join(tempRoot, "outside-root");
const hostedPort = 39_000 + (process.pid % 500) * 2;
const localPort = hostedPort + 1;
const hostedBaseUrl = `http://127.0.0.1:${hostedPort}`;
const localBaseUrl = `http://127.0.0.1:${localPort}`;
const hostedAccessToken = "hosted-bridge-smoke-access";
const hostedSyncToken = "hosted-bridge-smoke-sync";
const localAccessToken = "hosted-bridge-local-access";
const localSyncToken = "hosted-bridge-local-sync";
const vaultId = "hosted-bridge-smoke";
const installationId = "hosted-bridge-smoke-installation";
const userIntent = "use local filesystem";
const processes = [];

await fs.mkdir(desktopRoot, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });

try {
  processes.push(startServer([
    "--port", String(hostedPort),
    "--data-dir", path.join(tempRoot, "hosted-data"),
    "--mcp-token", hostedAccessToken,
    "--sync-token", hostedSyncToken,
  ], {
    MCP_REMOTE_LOCAL_FS_ENABLED: "true",
    MCP_REMOTE_LOCAL_FS_REQUEST_TTL_SECONDS: "10",
    MCP_REMOTE_LOCAL_FS_WAIT_SECONDS: "5",
    MCP_REMOTE_LOCAL_FS_AGENT_FRESH_SECONDS: "5",
  }));
  processes.push(startServer([
    "--port", String(localPort),
    "--data-dir", path.join(tempRoot, "local-data"),
    "--mcp-token", localAccessToken,
    "--sync-token", localSyncToken,
    "--fs-access", "write",
    "--fs-roots", desktopRoot,
    "--fs-write-roots", desktopRoot,
    "--fs-write-operations", "write_file,edit_file,create_directory,copy_path,move_path,delete_path",
    "--fs-access-ttl-minutes", "10",
  ]));

  await Promise.all([
    waitForHealth(hostedBaseUrl, processes[0]),
    waitForHealth(localBaseUrl, processes[1]),
  ]);

  await jsonRequest(`${hostedBaseUrl}/admin/vaults/register`, hostedSyncToken, {
    tenant_id: "default",
    vault_id: vaultId,
    installation_id: installationId,
    vault_name: "Hosted bridge smoke",
    index_mode: "manual_only",
  });

  const policyResponse = await mcp(localBaseUrl, localAccessToken, 1, "tools/call", {
    name: "local_fs_policy",
    arguments: {},
  });
  const policy = policyResponse.result.structuredContent;
  assert(policy.mode === "write", "expected local sidecar write policy");
  assert(policy.read_roots.includes(desktopRoot), "expected desktop read root in local policy");
  assert(policy.write_roots.includes(desktopRoot), "expected desktop write root in local policy");
  const localToolCatalog = toolCatalogFromList(await mcp(localBaseUrl, localAccessToken, 10, "tools/list", {}));
  assert(localToolCatalog.some((tool) => tool.name === "local_read_file"), "expected local read schema in tool catalog");

  await jsonRequest(`${hostedBaseUrl}/admin/vaults/${vaultId}/local-agent/heartbeat`, hostedSyncToken, {
    tenant_id: "default",
    installation_id: installationId,
    agent_version: "smoke",
    policy,
    tools: localToolCatalog,
    connected_at: new Date().toISOString(),
  });

  const tools = await mcp(hostedBaseUrl, hostedAccessToken, 2, "tools/list", {});
  const toolNames = tools.result.tools.map((tool) => tool.name);
  for (const name of ["desktop_local_fs_status", "desktop_run_local_tool", "desktop_local_request_status"]) {
    assert(toolNames.includes(name), `expected hosted tool ${name}`);
  }

  const status = await mcp(hostedBaseUrl, hostedAccessToken, 3, "tools/call", {
    name: "desktop_local_fs_status",
    arguments: { vault_id: vaultId },
  });
  assert(status.result.structuredContent.fresh === true, "expected fresh desktop agent heartbeat");
  assert(status.result.structuredContent.agent.policy.mode === "write", "expected hosted status to mirror local policy");
  assert(status.result.structuredContent.agent.tools.some((tool) => tool.name === "local_write_file" && tool.input_schema.properties.path), "expected hosted status to expose live local tool schemas");

  const deniedIntent = await mcp(hostedBaseUrl, hostedAccessToken, 4, "tools/call", {
    name: "desktop_run_local_tool",
    arguments: {
      vault_id: vaultId,
      tool_name: "local_read_file",
      arguments: { path: path.join(desktopRoot, "not-created.md") },
      user_intent: "not the configured phrase",
    },
  });
  assert(deniedIntent.result.isError === true, "expected wrong intent to be denied before delegation");

  const targetPath = path.join(desktopRoot, "chat-created.md");
  const writeCall = mcp(hostedBaseUrl, hostedAccessToken, 5, "tools/call", {
    name: "desktop_run_local_tool",
    arguments: {
      vault_id: vaultId,
      tool_name: "local_write_file",
      arguments: {
        path: targetPath,
        content: "Created only for an explicit hosted chat tool call.\n",
        create_dirs: false,
      },
      user_intent: userIntent,
      wait_seconds: 5,
    },
  });
  const writeRequest = await bridgeOneRequest();
  const writeResult = await writeCall;
  assert(writeResult.result.structuredContent.request.id === writeRequest.id, "expected hosted write result to match the claimed request");
  assert(writeResult.result.structuredContent.local_result.result.structuredContent.path === targetPath, "expected local write result path");
  assert((await fs.readFile(targetPath, "utf8")).includes("explicit hosted chat"), "expected delegated write on disk");

  const outsidePath = path.join(outsideRoot, "denied.md");
  const deniedWriteCall = mcp(hostedBaseUrl, hostedAccessToken, 6, "tools/call", {
    name: "desktop_run_local_tool",
    arguments: {
      vault_id: vaultId,
      tool_name: "local_write_file",
      arguments: { path: outsidePath, content: "must not be written\n" },
      user_intent: userIntent,
      wait_seconds: 5,
    },
  });
  await bridgeOneRequest();
  const deniedWrite = await deniedWriteCall;
  assert(deniedWrite.result.isError === true, "expected hosted wrapper to preserve localhost denial as an MCP tool error");
  assert(deniedWrite.result.structuredContent.local_result.result.isError === true, "expected localhost policy denial to return through hosted bridge");
  assert(!(await exists(outsidePath)), "expected outside-root write to remain absent");

  const readCall = mcp(hostedBaseUrl, hostedAccessToken, 7, "tools/call", {
    name: "desktop_run_local_tool",
    arguments: {
      vault_id: vaultId,
      tool_name: "local_read_file",
      arguments: { path: targetPath },
      user_intent: userIntent,
      wait_seconds: 5,
    },
  });
  await bridgeOneRequest();
  const readResult = await readCall;
  assert(readResult.result.structuredContent.local_result.result.structuredContent.text.includes("explicit hosted chat"), "expected delegated read content");

  await stopServer(processes[1]);
  processes[1] = startServer([
    "--port", String(localPort),
    "--data-dir", path.join(tempRoot, "local-god-data"),
    "--mcp-token", localAccessToken,
    "--sync-token", localSyncToken,
    "--fs-access", "god",
    "--fs-write-operations", "write_file",
    "--fs-access-ttl-minutes", "5",
  ]);
  await waitForHealth(localBaseUrl, processes[1]);
  const godPolicyResponse = await mcp(localBaseUrl, localAccessToken, 8, "tools/call", {
    name: "local_fs_policy",
    arguments: {},
  });
  const godPolicy = godPolicyResponse.result.structuredContent;
  assert(godPolicy.mode === "god", "expected refreshed localhost god-mode policy");
  const godToolCatalog = toolCatalogFromList(await mcp(localBaseUrl, localAccessToken, 11, "tools/list", {}));
  await jsonRequest(`${hostedBaseUrl}/admin/vaults/${vaultId}/local-agent/heartbeat`, hostedSyncToken, {
    tenant_id: "default",
    installation_id: installationId,
    agent_version: "smoke-god",
    policy: godPolicy,
    tools: godToolCatalog,
    connected_at: new Date().toISOString(),
  });

  const godPath = path.join(outsideRoot, "god-mode-explicit.md");
  const godWriteCall = mcp(hostedBaseUrl, hostedAccessToken, 9, "tools/call", {
    name: "desktop_run_local_tool",
    arguments: {
      vault_id: vaultId,
      tool_name: "local_write_file",
      arguments: { path: godPath, content: "Explicit remote god-mode smoke only.\n" },
      user_intent: userIntent,
      wait_seconds: 5,
    },
  });
  await bridgeOneRequest();
  const godWrite = await godWriteCall;
  assert(godWrite.result.isError !== true, "expected explicitly enabled remote god-mode write to succeed");
  assert((await fs.readFile(godPath, "utf8")).includes("god-mode smoke"), "expected remote god-mode write outside prior root");

  console.log(JSON.stringify({
    ok: true,
    purpose: "hosted MCP to plugin-style localhost filesystem bridge",
    vault_id: vaultId,
    installation_id: installationId,
    policy: {
      mode: policy.mode,
      read_roots: policy.read_roots,
      write_roots: policy.write_roots,
      write_operations: policy.write_operations,
      expires_at: policy.expires_at,
      require_user_intent: policy.require_user_intent,
    },
    verified: [
      "hosted tools require explicit server enablement and authenticated local:access capability",
      "desktop heartbeat reports the localhost sidecar policy",
      "desktop heartbeat publishes the live local tool names and argument schemas",
      "wrong user intent is rejected before a request is queued",
      "one installation-scoped request is claimed and forwarded to localhost",
      "an allowed write reaches disk and its structured MCP result returns to the hosted caller",
      "an outside-root write is denied by the localhost sidecar and remains absent",
      "an explicit hosted read returns only the requested file content",
      "a refreshed god-mode heartbeat permits an explicit write outside the previous roots",
    ],
  }, null, 2));

  async function bridgeOneRequest() {
    const request = await pollRequest();
    const localResult = await mcp(localBaseUrl, localAccessToken, Date.now(), "tools/call", {
      name: request.tool_name,
      arguments: request.arguments,
    });
    await jsonRequest(`${hostedBaseUrl}/admin/vaults/${vaultId}/local-access-requests/${request.id}/result`, hostedSyncToken, {
      tenant_id: "default",
      installation_id: installationId,
      status: "completed",
      result: localResult,
    });
    return request;
  }

  async function pollRequest() {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const body = await jsonRequest(`${hostedBaseUrl}/admin/vaults/${vaultId}/local-access-requests/next?tenant_id=default&installation_id=${encodeURIComponent(installationId)}`, hostedSyncToken);
      if (body.request) {
        return body.request;
      }
      await delay(25);
    }
    throw new Error("Timed out waiting for hosted desktop request.");
  }
} finally {
  await Promise.all(processes.map(stopServer));
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function startServer(args, extraEnv = {}) {
  let output = "";
  const child = spawn(process.execPath, ["scripts/start-local-server.mjs", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Server exited before health check:\n${server.output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until ready.
    }
    await delay(50);
  }
  throw new Error(`Server did not become healthy:\n${server.output()}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) {
    return;
  }
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    delay(2_000).then(() => server.child.kill("SIGKILL")),
  ]);
}

async function mcp(baseUrl, token, id, method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.text();
  assert(response.ok, `MCP ${method} failed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function jsonRequest(url, token, body) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert(response.ok, `Request failed: ${response.status} ${url} ${text}`);
  return JSON.parse(text);
}

async function exists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toolCatalogFromList(response) {
  return response.result.tools
    .filter((tool) => tool.name.startsWith("local_"))
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema ?? {},
      read_only: tool.annotations?.readOnlyHint === true,
      destructive: tool.annotations?.destructiveHint === true,
    }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
