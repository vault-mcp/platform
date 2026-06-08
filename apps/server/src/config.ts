import path from "node:path";
import { fileURLToPath } from "node:url";

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
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://127.0.0.1,http://localhost")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    oauth,
  };
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
