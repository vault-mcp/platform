import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalFsAccessMode, LocalFsPolicy, LocalFsWriteOperation } from "@vault-mcp/core";

export type ServerConfig = {
  host: string;
  port: number;
  publicBaseUrl: string;
  mcpResourceUrl: string;
  indexFile: string;
  databaseUrl: string | null;
  accessToken: string | null;
  syncToken: string;
  allowedOrigins: string[];
  oauth: OAuthResourceConfig | null;
  localFs: LocalFsPolicy;
};

export type OAuthResourceConfig = {
  issuer: string;
  audience: string;
  authorizationServer: string;
  jwksUrl: string | null;
  jwtSecret: string | null;
  authPassword: string | null;
  scopes: string[];
};

export function loadConfig(env = process.env): ServerConfig {
  const accessToken = env.MCP_ACCESS_TOKEN ?? null;
  const syncToken = env.MCP_SYNC_TOKEN;
  const oauth = loadOAuthConfig(env);

  if (!accessToken && !oauth) {
    throw new Error("MCP_ACCESS_TOKEN or OAuth config is required.");
  }

  if (!syncToken) {
    throw new Error("MCP_SYNC_TOKEN is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const indexFile = env.INDEX_FILE
    ? path.resolve(repoRoot, env.INDEX_FILE)
    : path.join(repoRoot, "data/index.json");
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3333").replace(/\/$/, "");

  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? "3333"),
    publicBaseUrl,
    mcpResourceUrl: `${publicBaseUrl}/mcp`,
    indexFile,
    databaseUrl: env.DATABASE_URL ?? null,
    accessToken,
    syncToken,
    allowedOrigins: uniqueOrigins([
      ...(env.ALLOWED_ORIGINS ?? "http://127.0.0.1,http://localhost")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      publicBaseUrl,
    ]),
    oauth,
    localFs: loadLocalFsPolicy(env),
  };
}

function uniqueOrigins(origins: string[]): string[] {
  return [...new Set(origins.map((origin) => origin.replace(/\/$/, "")))];
}

function loadLocalFsPolicy(env: NodeJS.ProcessEnv): LocalFsPolicy {
  const mode = normalizeLocalFsMode(env.LOCAL_FS_ACCESS_MODE);
  return {
    mode,
    read_roots: parsePathList(env.LOCAL_FS_READ_ROOTS ?? env.LOCAL_FS_ROOTS),
    write_roots: parsePathList(env.LOCAL_FS_WRITE_ROOTS),
    write_operations: parseLocalFsWriteOperations(env.LOCAL_FS_WRITE_OPERATIONS),
    max_read_bytes: normalizePositiveInteger(env.LOCAL_FS_MAX_READ_BYTES, 512 * 1024),
  };
}

function normalizeLocalFsMode(value: string | undefined): LocalFsAccessMode {
  const normalized = (value ?? "off").trim().toLowerCase();
  if (normalized === "off" || normalized === "read" || normalized === "write" || normalized === "god") {
    return normalized;
  }
  throw new Error("LOCAL_FS_ACCESS_MODE must be one of: off, read, write, god.");
}

function parsePathList(value: string | undefined): string[] {
  return uniquePathList((value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry)));
}

function uniquePathList(values: string[]): string[] {
  return [...new Set(values)];
}

function parseLocalFsWriteOperations(value: string | undefined): LocalFsWriteOperation[] {
  const rawOperations = value?.trim()
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : ["write_file"];
  const operations = rawOperations.map((operation) => {
    if (
      operation === "write_file"
      || operation === "create_directory"
      || operation === "move_path"
      || operation === "delete_path"
    ) {
      return operation;
    }
    throw new Error("LOCAL_FS_WRITE_OPERATIONS must contain only: write_file, create_directory, move_path, delete_path.");
  });
  return [...new Set(operations)];
}

function normalizePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("LOCAL_FS_MAX_READ_BYTES must be a positive integer.");
  }
  return parsed;
}

function loadOAuthConfig(env: NodeJS.ProcessEnv): OAuthResourceConfig | null {
  const issuer = env.OAUTH_ISSUER;
  const audience = env.OAUTH_AUDIENCE;
  const authorizationServer = env.OAUTH_AUTHORIZATION_SERVER ?? issuer;
  const jwksUrl = env.OAUTH_JWKS_URL ?? null;
  const jwtSecret = env.OAUTH_JWT_SECRET ?? null;
  const authPassword = env.OAUTH_AUTH_PASSWORD ?? null;

  if (!issuer && !audience && !jwksUrl && !jwtSecret) {
    return null;
  }

  if (!issuer || !audience || !authorizationServer || (!jwksUrl && !jwtSecret)) {
    throw new Error("OAuth config requires OAUTH_ISSUER, OAUTH_AUDIENCE, OAUTH_AUTHORIZATION_SERVER or issuer, and OAUTH_JWKS_URL or OAUTH_JWT_SECRET.");
  }

  return {
    issuer,
    audience,
    authorizationServer,
    jwksUrl,
    jwtSecret,
    authPassword,
    scopes: (env.OAUTH_SCOPES ?? "vault:read")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}
