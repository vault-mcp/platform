#!/usr/bin/env node
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(repoRoot, "dist", "local-sidecar", "vault-mcp-local-server.cjs");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-embedded-sidecar-"));
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
let server;

try {
  const embedded = require(bundlePath);
  server = await embedded.startEmbeddedLocalServer({
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_BASE_URL: baseUrl,
    VAULT_MCP_RUNTIME_ROOT: repoRoot,
    INDEX_FILE: path.join(dataDir, "index.json"),
    MCP_ACCESS_TOKEN: "embedded-smoke-mcp-token",
    MCP_SYNC_TOKEN: "embedded-smoke-sync-token",
    LOCAL_FS_ACCESS_MODE: "off",
  });
  const response = await fetch(`${baseUrl}/healthz`);
  const health = await response.json();
  assert(response.ok && health.ok === true, "embedded sidecar health check failed");
  assert(health.service?.mcp_resource_url === `${baseUrl}/mcp`, "embedded sidecar advertised the wrong MCP endpoint");
  await server.close();
  server = undefined;
  assert(await canListen(port), "embedded sidecar did not release its port after close");
  console.log(JSON.stringify({
    ok: true,
    purpose: "packaged Obsidian embedded sidecar start/health/stop smoke",
    service: health.service,
    storage: health.storage,
    port_released: true,
  }, null, 2));
} finally {
  await server?.close().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error("failed to select a port")));
    });
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
