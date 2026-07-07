#!/usr/bin/env node
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import esbuild from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(repoRoot, "dist", "local-sidecar");
const serverBundlePath = path.join(outputDir, "vault-mcp-local-server.mjs");
const launcherPath = path.join(outputDir, "start-local-server.mjs");
const manifestPath = path.join(outputDir, "sidecar-manifest.json");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, "apps", "server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: serverBundlePath,
  packages: "bundle",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "silent",
});

await writeFile(launcherPath, sidecarLauncherSource(), "utf8");

const serverStat = await assertFile(serverBundlePath, "server bundle");
const launcherStat = await assertFile(launcherPath, "sidecar launcher");
const serverSha256 = await sha256File(serverBundlePath);
const launcherSha256 = await sha256File(launcherPath);

await writeFile(manifestPath, `${JSON.stringify({
  name: "vault-mcp-local-sidecar",
  version: "0.1.0",
  node: ">=20",
  entrypoint: "start-local-server.mjs",
  serverBundle: "vault-mcp-local-server.mjs",
  files: {
    "start-local-server.mjs": {
      bytes: launcherStat.size,
      sha256: launcherSha256,
    },
    "vault-mcp-local-server.mjs": {
      bytes: serverStat.size,
      sha256: serverSha256,
    },
  },
}, null, 2)}\n`, "utf8");

await assertFile(manifestPath, "sidecar manifest");

console.log(JSON.stringify({
  ok: true,
  outputDir,
  files: {
    launcher: launcherPath,
    serverBundle: serverBundlePath,
    manifest: manifestPath,
  },
  sha256: {
    launcher: launcherSha256,
    serverBundle: serverSha256,
  },
}, null, 2));

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  if (!result?.isFile() || result.size <= 0) {
    throw new Error(`Expected non-empty ${label}: ${value}`);
  }
  return result;
}

async function sha256File(file) {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
}

function sidecarLauncherSource() {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
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
const publicBaseUrl = \`http://\${host}:\${port}\`;
const dataDir = path.resolve(sidecarRoot, args.dataDir ?? process.env.VAULT_MCP_LOCAL_DATA_DIR ?? "data/local-server");
const indexFile = path.join(dataDir, "index.json");
const mcpAccessToken = args.mcpToken ?? process.env.MCP_ACCESS_TOKEN ?? randomToken();
const syncToken = args.syncToken ?? process.env.MCP_SYNC_TOKEN ?? randomToken();
const localFsAccessMode = args.fsAccess ?? process.env.LOCAL_FS_ACCESS_MODE ?? "off";
const localFsReadRoots = args.fsRoots ?? process.env.LOCAL_FS_READ_ROOTS ?? process.env.LOCAL_FS_ROOTS ?? "";
const localFsWriteRoots = args.fsWriteRoots ?? process.env.LOCAL_FS_WRITE_ROOTS ?? "";
const localFsWriteOperations = args.fsWriteOperations ?? process.env.LOCAL_FS_WRITE_OPERATIONS ?? "write_file";
const localFsMaxReadBytes = args.fsMaxReadBytes ?? process.env.LOCAL_FS_MAX_READ_BYTES ?? "524288";
const localFsMaxSearchResults = args.fsMaxSearchResults ?? process.env.LOCAL_FS_MAX_SEARCH_RESULTS ?? "100";
const localFsMaxSearchFiles = args.fsMaxSearchFiles ?? process.env.LOCAL_FS_MAX_SEARCH_FILES ?? "2000";
const localFsAccessExpiresAt = args.fsAccessExpiresAt
  ?? process.env.LOCAL_FS_ACCESS_EXPIRES_AT
  ?? expiresAtFromTtl(args.fsAccessTtlMinutes ?? process.env.LOCAL_FS_ACCESS_TTL_MINUTES);
const allowedOrigins = args.allowedOrigins
  ?? process.env.ALLOWED_ORIGINS
  ?? [
    publicBaseUrl,
    \`http://localhost:\${port}\`,
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
  LOCAL_FS_WRITE_OPERATIONS: localFsWriteOperations,
  LOCAL_FS_MAX_READ_BYTES: localFsMaxReadBytes,
  LOCAL_FS_MAX_SEARCH_RESULTS: localFsMaxSearchResults,
  LOCAL_FS_MAX_SEARCH_FILES: localFsMaxSearchFiles,
  LOCAL_FS_ACCESS_EXPIRES_AT: localFsAccessExpiresAt,
});
delete process.env.DATABASE_URL;

console.log("Vault MCP packaged local sidecar profile");
console.log(\`MCP endpoint: \${publicBaseUrl}/mcp\`);
console.log(\`Health check: \${publicBaseUrl}/healthz\`);
console.log(\`Index file: \${indexFile}\`);
console.log(\`Local filesystem access: \${localFsAccessMode}\`);
if (localFsReadRoots) {
  console.log(\`Local read roots: \${localFsReadRoots}\`);
}
if (localFsWriteRoots) {
  console.log(\`Local write roots: \${localFsWriteRoots}\`);
}
console.log(\`Local write operations: \${localFsWriteOperations}\`);
console.log(\`Local search caps: \${localFsMaxSearchResults} results, \${localFsMaxSearchFiles} files scanned\`);
if (localFsAccessExpiresAt) {
  console.log(\`Local filesystem access expires: \${localFsAccessExpiresAt}\`);
}
console.log(\`MCP access token: \${mcpAccessToken}\`);
console.log(\`Plugin sync token: \${syncToken}\`);
console.log("Keep these local tokens private. Stop with Ctrl+C.");

await import("./vault-mcp-local-server.mjs");

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
    if (value === "--fs-write-operations") {
      parsed.fsWriteOperations = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-max-read-bytes") {
      parsed.fsMaxReadBytes = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-max-search-results") {
      parsed.fsMaxSearchResults = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-max-search-files") {
      parsed.fsMaxSearchFiles = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-access-expires-at") {
      parsed.fsAccessExpiresAt = readValue(values, ++index, value);
      continue;
    }
    if (value === "--fs-access-ttl-minutes") {
      parsed.fsAccessTtlMinutes = readValue(values, ++index, value);
      continue;
    }
    throw new Error(\`Unknown option: \${value}\`);
  }
  return parsed;
}

function readValue(values, index, name) {
  const value = values[index];
  if (!value || value.startsWith("--")) {
    throw new Error(\`\${name} requires a value.\`);
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

function expiresAtFromTtl(value) {
  if (!value) {
    return "";
  }
  const minutes = Number.parseInt(value, 10);
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error("--fs-access-ttl-minutes must be 0 or a positive integer.");
  }
  if (minutes === 0) {
    return "";
  }
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function printHelp() {
  console.log(\`Start a packaged local-only Vault MCP server profile.

Usage:
  node sidecar/start-local-server.mjs [options]

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
  --fs-write-operations <ops>   Comma-separated write_file,create_directory,move_path,delete_path. Defaults to write_file.
  --fs-max-read-bytes <bytes>   Max bytes returned by local_read_file. Defaults to 524288.
  --fs-max-search-results <n>   Max local find/search results. Defaults to 100.
  --fs-max-search-files <n>     Max files scanned by local_search_text. Defaults to 2000.
  --fs-access-ttl-minutes <n>   Optional local filesystem access window. 0 disables expiry.
  --fs-access-expires-at <iso>  Optional explicit local filesystem access expiry timestamp.
  --help                        Show this help.
\`);
}
`;
}
