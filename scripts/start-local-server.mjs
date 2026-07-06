#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const host = args.host ?? process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("Local server mode must bind to 127.0.0.1 or localhost.");
}

const port = normalizePort(args.port ?? process.env.PORT ?? "38791");
const publicBaseUrl = `http://${host}:${port}`;
const dataDir = path.resolve(repoRoot, args.dataDir ?? process.env.VAULT_MCP_LOCAL_DATA_DIR ?? "data/local-server");
const indexFile = path.join(dataDir, "index.json");
const mcpAccessToken = args.mcpToken ?? process.env.MCP_ACCESS_TOKEN ?? randomToken();
const syncToken = args.syncToken ?? process.env.MCP_SYNC_TOKEN ?? randomToken();
const localFsAccessMode = args.fsAccess ?? process.env.LOCAL_FS_ACCESS_MODE ?? "off";
const localFsReadRoots = args.fsRoots ?? process.env.LOCAL_FS_READ_ROOTS ?? process.env.LOCAL_FS_ROOTS ?? "";
const localFsWriteRoots = args.fsWriteRoots ?? process.env.LOCAL_FS_WRITE_ROOTS ?? "";
const localFsMaxReadBytes = args.fsMaxReadBytes ?? process.env.LOCAL_FS_MAX_READ_BYTES ?? "524288";
const allowedOrigins = args.allowedOrigins
  ?? process.env.ALLOWED_ORIGINS
  ?? [
    publicBaseUrl,
    `http://localhost:${port}`,
    "http://localhost:6274",
    "http://127.0.0.1:6274",
  ].join(",");

await fs.mkdir(dataDir, { recursive: true });

Object.assign(process.env, {
  HOST: host,
  PORT: String(port),
  PUBLIC_BASE_URL: publicBaseUrl,
  INDEX_FILE: indexFile,
  MCP_ACCESS_TOKEN: mcpAccessToken,
  MCP_SYNC_TOKEN: syncToken,
  ALLOWED_ORIGINS: allowedOrigins,
  LOCAL_FS_ACCESS_MODE: localFsAccessMode,
  LOCAL_FS_READ_ROOTS: localFsReadRoots,
  LOCAL_FS_WRITE_ROOTS: localFsWriteRoots,
  LOCAL_FS_MAX_READ_BYTES: localFsMaxReadBytes,
});
delete process.env.DATABASE_URL;

console.log("Vault MCP local desktop server profile");
console.log(`MCP endpoint: ${publicBaseUrl}/mcp`);
console.log(`Health check: ${publicBaseUrl}/healthz`);
console.log(`Index file: ${indexFile}`);
console.log(`Local filesystem access: ${localFsAccessMode}`);
if (localFsReadRoots) {
  console.log(`Local read roots: ${localFsReadRoots}`);
}
if (localFsWriteRoots) {
  console.log(`Local write roots: ${localFsWriteRoots}`);
}
console.log(`MCP access token: ${mcpAccessToken}`);
console.log(`Plugin sync token: ${syncToken}`);
console.log("Keep these local tokens private. Stop with Ctrl+C.");

await import("../apps/server/dist/index.js");

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
      continue;
    }
    if (value === "--host") {
      parsed.host = readValue(values, ++index, value);
      continue;
    }
    if (value === "--port") {
      parsed.port = readValue(values, ++index, value);
      continue;
    }
    if (value === "--data-dir") {
      parsed.dataDir = readValue(values, ++index, value);
      continue;
    }
    if (value === "--mcp-token") {
      parsed.mcpToken = readValue(values, ++index, value);
      continue;
    }
    if (value === "--sync-token") {
      parsed.syncToken = readValue(values, ++index, value);
      continue;
    }
    if (value === "--allowed-origins") {
      parsed.allowedOrigins = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-access") {
      parsed.fsAccess = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-roots") {
      parsed.fsRoots = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-write-roots") {
      parsed.fsWriteRoots = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-max-read-bytes") {
      parsed.fsMaxReadBytes = readValue(values, ++index, value);
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }
  return parsed;
}

function readValue(values, index, name) {
  const value = values[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Local server port must be an integer from 1024 to 65535.");
  }
  return port;
}

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function printHelp() {
  console.log(`Start a local-only Vault MCP server profile.

Usage:
  node scripts/start-local-server.mjs [options]

Options:
  --host <host>                 Bind host. Defaults to 127.0.0.1.
  --port <port>                 Bind port. Defaults to 38791.
  --data-dir <path>             Local JSON storage folder. Defaults to data/local-server.
  --mcp-token <token>           MCP client bearer token. Defaults to a generated local token.
  --sync-token <token>          Plugin/admin sync token. Defaults to a generated local token.
  --allowed-origins <origins>   Comma-separated allowed browser origins.
  --fs-access <mode>            Local filesystem tools: off, read, write, or god. Defaults to off.
  --fs-roots <paths>            Comma-separated read roots for local filesystem tools.
  --fs-write-roots <paths>      Comma-separated write roots for local filesystem tools.
  --fs-max-read-bytes <bytes>   Max bytes returned by local_read_file. Defaults to 524288.
  --help                        Show this help.

Run npm run build --workspace @vault-mcp/server before starting directly.
`);
}
