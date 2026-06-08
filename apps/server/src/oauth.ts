import crypto from "node:crypto";
import type { Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { OAuthResourceConfig, ServerConfig } from "./config.js";
import type { IndexStore } from "./store.js";

type AuthorizationCode = {
  type: "authorization_code";
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  code_challenge: string;
  code_challenge_method: "S256";
  sub: string;
};

type RefreshToken = {
  type: "refresh_token";
  client_id: string;
  scope: string;
  resource: string;
  sub: string;
};

const CODE_AUDIENCE = "vault-mcp-oauth-code";
const REFRESH_AUDIENCE = "vault-mcp-oauth-refresh";
const TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TTL = "30d";

export function registerOAuthRoutes(app: import("express").Express, config: ServerConfig): void {
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json(authorizationServerMetadata(config));
  });

  app.get("/.well-known/oauth-authorization-server/mcp", (_req: Request, res: Response) => {
    res.json(authorizationServerMetadata(config));
  });

  app.get("/.well-known/openid-configuration", (_req: Request, res: Response) => {
    res.json(authorizationServerMetadata(config));
  });

  app.post("/oauth/register", async (req: Request, res: Response) => {
    try {
      const oauth = requireSelfHostedOAuth(config);
      const redirectUrisInput = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris as unknown[] : [];
      if (redirectUrisInput.length === 0 || !redirectUrisInput.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))) {
        res.status(400).json({ error: "invalid_redirect_uris" });
        return;
      }
      const redirectUris = redirectUrisInput as string[];

      const requestedScope = typeof req.body?.scope === "string" ? req.body.scope : oauth.scopes.join(" ");
      const scope = normalizeScope(requestedScope, oauth);
      if (!scope) {
        res.status(400).json({ error: "invalid_scope" });
        return;
      }

      const clientName = typeof req.body?.client_name === "string" && req.body.client_name.trim()
        ? req.body.client_name.trim().slice(0, 120)
        : "Vault MCP Client";
      const clientId = `vault-mcp-client-${crypto.randomUUID()}`;
      await getOAuthStore(req).saveOAuthClient({
        clientId,
        redirectUris,
        clientName,
        scope,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope,
        token_endpoint_auth_method: "none",
      });
    } catch (error) {
      internalOAuthError(res, error);
    }
  });

  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    try {
      await validateAuthorizationRequest(req, config);
      res.status(200).type("html").send(renderAuthorizeForm(req));
    } catch (error) {
      oauthRequestError(res, error);
    }
  });

  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    try {
      const oauth = requireSelfHostedOAuth(config);
      if (typeof req.body?.password !== "string" || !timingSafeEqual(req.body.password, oauth.authPassword ?? "")) {
        res.status(401).type("html").send("<!doctype html><title>Unauthorized</title><p>Unauthorized.</p>");
        return;
      }

      const authRequest = await validateAuthorizationRequest(req, config);
      const code = await signAuthorizationCode({
        type: "authorization_code",
        client_id: authRequest.client_id,
        redirect_uri: authRequest.redirect_uri,
        scope: authRequest.scope,
        resource: authRequest.resource,
        code_challenge: authRequest.code_challenge,
        code_challenge_method: "S256",
        sub: "tristan",
      }, oauth);

      const redirect = new URL(authRequest.redirect_uri);
      redirect.searchParams.set("code", code);
      if (authRequest.state) {
        redirect.searchParams.set("state", authRequest.state);
      }
      res.redirect(302, redirect.toString());
    } catch (error) {
      oauthRequestError(res, error);
    }
  });

  app.post("/oauth/token", async (req: Request, res: Response) => {
    try {
      const oauth = requireSelfHostedOAuth(config);
      const grantType = stringParam(req, "grant_type");
      if (grantType === "authorization_code") {
        await handleAuthorizationCodeGrant(req, res, config, oauth, getOAuthStore(req));
        return;
      }
      if (grantType === "refresh_token") {
        await handleRefreshGrant(req, res, config, oauth, getOAuthStore(req));
        return;
      }

      res.status(400).json({ error: "unsupported_grant_type" });
    } catch (error) {
      internalOAuthError(res, error);
    }
  });
}

export function authorizationServerMetadata(config: ServerConfig) {
  return {
    issuer: config.oauth?.issuer ?? config.publicBaseUrl,
    authorization_endpoint: `${config.publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${config.publicBaseUrl}/oauth/token`,
    registration_endpoint: `${config.publicBaseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: config.oauth?.scopes ?? ["vault:read"],
    resource_documentation: `${config.publicBaseUrl}/healthz`,
  };
}

export function attachOAuthStore(req: Request, store: IndexStore): void {
  (req as Request & { oauthStore?: IndexStore }).oauthStore = store;
}

async function handleAuthorizationCodeGrant(req: Request, res: Response, config: ServerConfig, oauth: OAuthResourceConfig, store: IndexStore): Promise<void> {
  const clientId = stringParam(req, "client_id");
  const redirectUri = stringParam(req, "redirect_uri");
  const codeVerifier = stringParam(req, "code_verifier");
  const resource = stringParam(req, "resource") || config.mcpResourceUrl;
  const code = stringParam(req, "code");
  if (!clientId || !redirectUri || !codeVerifier || !code) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const client = await store.getOAuthClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }

  const { payload, jti, expiresAt } = await verifyAuthorizationCode(code, oauth);
  if (
    payload.client_id !== clientId ||
    payload.redirect_uri !== redirectUri ||
    payload.resource !== resource ||
    !timingSafeEqual(payload.code_challenge, pkceChallenge(codeVerifier))
  ) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (!await store.consumeOAuthJti(jti, "authorization_code", expiresAt)) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }

  res.json(await tokenResponse({
    client_id: clientId,
    resource,
    scope: payload.scope,
    sub: payload.sub,
  }, oauth));
}

async function handleRefreshGrant(req: Request, res: Response, config: ServerConfig, oauth: OAuthResourceConfig, store: IndexStore): Promise<void> {
  const refreshToken = stringParam(req, "refresh_token");
  const resource = stringParam(req, "resource") || config.mcpResourceUrl;
  if (!refreshToken) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const { payload, jti, expiresAt } = await verifyRefreshToken(refreshToken, oauth);
  if (payload.resource !== resource) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (!await store.consumeOAuthJti(jti, "refresh_token", expiresAt)) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }

  res.json(await tokenResponse(payload, oauth));
}

async function tokenResponse(input: { client_id: string; resource: string; scope: string; sub: string }, oauth: OAuthResourceConfig) {
  const accessToken = await new SignJWT({ sub: input.sub, scope: input.scope, client_id: input.client_id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(oauth.issuer)
    .setAudience(input.resource)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(oauth));
  const refreshToken = await signRefreshToken({
    type: "refresh_token",
    client_id: input.client_id,
    scope: input.scope,
    resource: input.resource,
    sub: input.sub,
  }, oauth);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

async function validateAuthorizationRequest(req: Request, config: ServerConfig) {
  const oauth = requireSelfHostedOAuth(config);
  const responseType = stringParam(req, "response_type");
  const clientId = stringParam(req, "client_id");
  const redirectUri = stringParam(req, "redirect_uri");
  const codeChallenge = stringParam(req, "code_challenge");
  const codeChallengeMethod = stringParam(req, "code_challenge_method");
  const resource = stringParam(req, "resource") || config.mcpResourceUrl;
  const state = stringParam(req, "state");
  const scope = normalizeScope(stringParam(req, "scope") || oauth.scopes.join(" "), oauth);

  if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== "S256" || !scope) {
    throw new OAuthRequestError("invalid_request");
  }
  if (resource !== config.mcpResourceUrl) {
    throw new OAuthRequestError("invalid_target");
  }

  const client = await getOAuthStore(req).getOAuthClient(clientId);
  if (!client) {
    throw new OAuthRequestError("invalid_client");
  }
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthRequestError("invalid_redirect_uri");
  }
  if (!scopeIncludes(client.scope, scope)) {
    throw new OAuthRequestError("invalid_scope");
  }

  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    resource,
    scope,
    state,
  };
}

async function signAuthorizationCode(code: AuthorizationCode, oauth: OAuthResourceConfig): Promise<string> {
  return new SignJWT(code)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(oauth.issuer)
    .setAudience(CODE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(secretKey(oauth));
}

async function verifyAuthorizationCode(code: string, oauth: OAuthResourceConfig): Promise<{ payload: AuthorizationCode; jti: string; expiresAt: Date }> {
  const { payload } = await jwtVerify(code, secretKey(oauth), {
    issuer: oauth.issuer,
    audience: CODE_AUDIENCE,
  });
  if (payload.type !== "authorization_code" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    throw new OAuthRequestError("invalid_grant");
  }
  return {
    payload: payload as AuthorizationCode,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
  };
}

async function signRefreshToken(token: RefreshToken, oauth: OAuthResourceConfig): Promise<string> {
  return new SignJWT(token)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(oauth.issuer)
    .setAudience(REFRESH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .setJti(crypto.randomUUID())
    .sign(secretKey(oauth));
}

async function verifyRefreshToken(token: string, oauth: OAuthResourceConfig): Promise<{ payload: RefreshToken; jti: string; expiresAt: Date }> {
  const { payload } = await jwtVerify(token, secretKey(oauth), {
    issuer: oauth.issuer,
    audience: REFRESH_AUDIENCE,
  });
  if (payload.type !== "refresh_token" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    throw new OAuthRequestError("invalid_grant");
  }
  return {
    payload: payload as RefreshToken,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
  };
}

function requireSelfHostedOAuth(config: ServerConfig): OAuthResourceConfig {
  const oauth = config.oauth;
  if (!oauth?.jwtSecret || !oauth.authPassword) {
    throw new OAuthRequestError("oauth_not_configured", 503);
  }
  return oauth;
}

function normalizeScope(scope: string, oauth: OAuthResourceConfig): string | null {
  const requested = scope.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const supported = new Set(oauth.scopes);
  if (requested.length === 0 || requested.some((part) => !supported.has(part))) {
    return null;
  }
  return requested.join(" ");
}

function scopeIncludes(granted: string, requested: string): boolean {
  const grantedScopes = new Set(granted.split(/\s+/).map((part) => part.trim()).filter(Boolean));
  return requested.split(/\s+/).map((part) => part.trim()).filter(Boolean).every((scope) => grantedScopes.has(scope));
}

function stringParam(req: Request, name: string): string {
  const value = req.body?.[name] ?? req.query?.[name];
  return typeof value === "string" ? value : "";
}

function getOAuthStore(req: Request): IndexStore {
  const store = (req as Request & { oauthStore?: IndexStore }).oauthStore;
  if (!store) {
    throw new OAuthRequestError("oauth_store_not_configured", 503);
  }
  return store;
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  } catch {
    return false;
  }
}

function renderAuthorizeForm(req: Request): string {
  const hiddenFields = Object.entries(req.query)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}">`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Vault MCP Connector</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; max-width: 34rem; line-height: 1.5; }
    label { display: block; font-weight: 600; margin-bottom: .4rem; }
    input[type="password"] { box-sizing: border-box; width: 100%; padding: .65rem; font: inherit; }
    button { margin-top: 1rem; padding: .65rem .9rem; font: inherit; }
  </style>
</head>
<body>
  <h1>Authorize Vault MCP Connector</h1>
  <p>This grants read-only search and fetch access to the selected vault index.</p>
  <form method="post" action="/oauth/authorize">
    ${hiddenFields}
    <label for="password">Connector password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function secretKey(oauth: OAuthResourceConfig): Uint8Array {
  return new TextEncoder().encode(oauth.jwtSecret ?? "");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}

function oauthRequestError(res: Response, error: unknown): void {
  if (error instanceof OAuthRequestError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  internalOAuthError(res, error);
}

function internalOAuthError(res: Response, error: unknown): void {
  console.error("OAuth error:", error);
  res.status(500).json({ error: "server_error" });
}

class OAuthRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
