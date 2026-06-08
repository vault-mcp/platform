import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ServerConfig } from "./config.js";

const CORS_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
];

export function requireBearerToken(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("Authorization");
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (token !== expectedToken) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    next();
  };
}

export function requireUserAuth(config: ServerConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);

    if (token && config.accessToken && token === config.accessToken) {
      next();
      return;
    }

    if (token && config.oauth) {
      try {
        await verifyOAuthToken(token, config);
        next();
        return;
      } catch {
        unauthorized(res, config, "invalid_token");
        return;
      }
    }

    unauthorized(res, config);
  };
}

export function protectedResourceMetadata(config: ServerConfig) {
  return {
    resource: config.mcpResourceUrl,
    authorization_servers: config.oauth ? [config.oauth.authorizationServer] : [],
    scopes_supported: config.oauth?.scopes ?? ["vault:read"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicBaseUrl}/healthz`,
  };
}

export function requireAllowedOrigin(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("Origin");
    if (!origin) {
      next();
      return;
    }

    if (allowedOrigins.some((allowed) => origin === allowed || origin.startsWith(`${allowed}:`))) {
      next();
      return;
    }

    res.status(403).json({ error: "forbidden_origin" });
  };
}

export function applyCors(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("Origin");
    if (!origin) {
      next();
      return;
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      res.status(403).json({ error: "forbidden_origin" });
      return;
    }

    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.set("Access-Control-Allow-Headers", CORS_HEADERS.join(","));
    res.set("Access-Control-Expose-Headers", "WWW-Authenticate,Mcp-Session-Id");
    res.set("Vary", appendVary(res.get("Vary"), "Origin"));

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

function bearerToken(req: Request): string | null {
  const header = req.header("Authorization");
  return header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((allowed) => origin === allowed || origin.startsWith(`${allowed}:`));
}

function appendVary(current: string | string[] | undefined, value: string): string {
  const existing = Array.isArray(current) ? current.join(",") : current;
  if (!existing) {
    return value;
  }

  return existing.split(",").map((part) => part.trim()).includes(value)
    ? existing
    : `${existing}, ${value}`;
}

async function verifyOAuthToken(token: string, config: ServerConfig): Promise<void> {
  const oauth = config.oauth;
  if (!oauth) {
    throw new Error("OAuth is not configured.");
  }

  if (oauth.jwtSecret) {
    await jwtVerify(token, new TextEncoder().encode(oauth.jwtSecret), {
      issuer: oauth.issuer,
      audience: oauth.audience,
    });
    return;
  }

  await jwtVerify(token, createRemoteJWKSet(new URL(oauth.jwksUrl ?? "")), {
    issuer: oauth.issuer,
    audience: oauth.audience,
  });
}

function unauthorized(res: Response, config: ServerConfig, error?: string): void {
  const metadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource`;
  const parts = [`resource_metadata="${metadataUrl}"`];
  if (error) {
    parts.push(`error="${error}"`);
  }

  res
    .status(401)
    .set("WWW-Authenticate", `Bearer ${parts.join(", ")}`)
    .json({ error: "unauthorized" });
}
