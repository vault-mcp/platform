import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "./config.js";
import { createApp } from "./app.js";
import { JsonIndexStore } from "./store.js";
import type { VaultDocument } from "@vault-mcp/vault-core";

const servers: http.Server[] = [];

describe("server MCP contract", () => {
  it("serves the public landing page without authentication", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Vault context, wired for AI clients.");
  });

  it("serves the public wiki without authentication", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const response = await fetch(`${baseUrl}/wiki/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Vault MCP Connector Wiki");
  });

  it("syncs documents and exposes read-only search/fetch over authenticated MCP", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,text/event-stream",
      },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(await syncStatus(baseUrl, "wrong-token", [])).toBe(401);

    const syncResponse = await fetch(`${baseUrl}/admin/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.syncToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documents: [fixtureDocument()],
        generated_at: "2026-06-08T00:00:00.000Z",
      }),
    });
    expect(syncResponse.status).toBe(200);

    const accessToken = config.accessToken ?? "";
    const tools = await mcp(baseUrl, accessToken, 1, "tools/list", {});
    expect(tools.result.tools?.map((tool) => tool.name)).toEqual(["search", "fetch"]);
    await expectMcpSseProbe(baseUrl, accessToken);

    const search = await mcp(baseUrl, accessToken, 2, "tools/call", {
      name: "search",
      arguments: { query: "remote MCP", limit: 1 },
    });
    expect(search.result.structuredContent.results[0].id).toBe("doc-1");

    const fetched = await mcp(baseUrl, accessToken, 3, "tools/call", {
      name: "fetch",
      arguments: { id: "doc-1" },
    });
    expect(fetched.result.structuredContent.title).toBe("Vault MCP Connector");

    const guessed = await mcp(baseUrl, accessToken, 4, "tools/call", {
      name: "fetch",
      arguments: { id: "guessed-denied-id" },
    });
    expect(guessed.result.isError).toBe(true);

    expect(await syncStatus(baseUrl, config.syncToken, [])).toBe(200);
    const healthAfterDelete = await (await fetch(`${baseUrl}/healthz`)).json() as { document_count: number };
    expect(healthAfterDelete.document_count).toBe(0);
  });

  it("supports authenticated GET /mcp as a Streamable HTTP SSE stream", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const accessToken = config.accessToken ?? "";

    const missingSseAccept = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    expect(missingSseAccept.status).toBe(406);

    await expectMcpSseProbe(baseUrl, accessToken);
  });

  it("treats admin sync as an idempotent full replacement", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const original = fixtureDocument({
      contentHash: "hash-v1",
      text: "Original-only content about remote MCP.",
      updatedAt: "2026-06-08T00:00:00.000Z",
    });
    expect(await syncStatus(baseUrl, config.syncToken, [original])).toBe(200);
    expect(await syncStatus(baseUrl, config.syncToken, [original])).toBe(200);

    const healthAfterRepeat = await (await fetch(`${baseUrl}/healthz`)).json() as { document_count: number };
    expect(healthAfterRepeat.document_count).toBe(1);

    const accessToken = config.accessToken ?? "";
    const fetchedOriginal = await mcp(baseUrl, accessToken, 1, "tools/call", {
      name: "fetch",
      arguments: { id: original.id },
    });
    expect(fetchedOriginal.result.structuredContent.metadata.content_hash).toBe("hash-v1");

    const updated = fixtureDocument({
      contentHash: "hash-v2",
      text: "Updated-only content about remote MCP and production sync.",
      updatedAt: "2026-06-08T01:00:00.000Z",
    });
    expect(await syncStatus(baseUrl, config.syncToken, [updated])).toBe(200);

    const fetchedUpdated = await mcp(baseUrl, accessToken, 2, "tools/call", {
      name: "fetch",
      arguments: { id: updated.id },
    });
    expect(fetchedUpdated.result.structuredContent.text).toContain("Updated-only");
    expect(fetchedUpdated.result.structuredContent.metadata.content_hash).toBe("hash-v2");

    const staleSearch = await mcp(baseUrl, accessToken, 3, "tools/call", {
      name: "search",
      arguments: { query: "Original-only", limit: 1 },
    });
    expect(staleSearch.result.structuredContent.results).toHaveLength(0);

    expect(await syncStatus(baseUrl, config.syncToken, [])).toBe(200);
    const healthAfterDelete = await (await fetch(`${baseUrl}/healthz`)).json() as { document_count: number };
    expect(healthAfterDelete.document_count).toBe(0);

    const deletedFetch = await fetch(`${baseUrl}/notes/${updated.id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(deletedFetch.status).toBe(404);
  });

  it("handles allowed CORS preflight and rejects forbidden origins", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile);
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const preflight = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization,Content-Type,Accept",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(preflight.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");

    const denied = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json,text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "forbidden_origin" });
  });

  it("allows the configured public origin for self-hosted OAuth pages", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile, {
      publicBaseUrl: "https://vault.example.test",
      allowedOrigins: ["https://chatgpt.com"],
    });
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const response = await fetch(`${baseUrl}/oauth/authorize`, {
      headers: {
        Origin: "https://vault.example.test",
      },
    });

    expect(response.status).not.toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://vault.example.test");
    expect(await response.json()).not.toEqual({ error: "forbidden_origin" });
  });

  it("advertises protected-resource metadata and accepts configured OAuth JWTs", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile, {
      accessToken: null,
      oauth: {
        issuer: "https://auth.example.test",
        audience: "https://vault.example.test/mcp",
        authorizationServer: "https://auth.example.test",
        jwksUrl: null,
        jwtSecret: "test-oauth-secret",
        authPassword: null,
        scopes: ["vault:read"],
      },
    });
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)).json() as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(metadata.resource).toBe(config.mcpResourceUrl);
    expect(metadata.authorization_servers).toEqual(["https://auth.example.test"]);
    expect(metadata.scopes_supported).toEqual(["vault:read"]);

    const jwt = await new SignJWT({ sub: "user-1", scope: "vault:read" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://auth.example.test")
      .setAudience("https://vault.example.test/mcp")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("test-oauth-secret"));

    const tools = await mcp(baseUrl, jwt, 1, "tools/list", {});
    expect(tools.result.tools?.map((tool) => tool.name)).toEqual(["search", "fetch"]);
  });

  it("supports self-hosted OAuth dynamic registration, PKCE code exchange, and refresh", async () => {
    const { store, indexFile } = await createStore();
    const config = testConfig(indexFile, {
      accessToken: null,
      publicBaseUrl: "http://127.0.0.1:0",
      mcpResourceUrl: "http://127.0.0.1:0/mcp",
      oauth: {
        issuer: "http://127.0.0.1:0",
        audience: "http://127.0.0.1:0/mcp",
        authorizationServer: "http://127.0.0.1:0",
        jwksUrl: null,
        jwtSecret: "test-oauth-secret",
        authPassword: "authorize-me",
        scopes: ["vault:read"],
      },
    });
    const server = await listen(createApp(config, store));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    config.publicBaseUrl = baseUrl;
    config.mcpResourceUrl = `${baseUrl}/mcp`;
    config.oauth = {
      ...config.oauth!,
      issuer: baseUrl,
      audience: `${baseUrl}/mcp`,
      authorizationServer: baseUrl,
    };

    const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json() as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(metadata.issuer).toBe(baseUrl);
    expect(metadata.authorization_endpoint).toBe(`${baseUrl}/oauth/authorize`);
    expect(metadata.token_endpoint).toBe(`${baseUrl}/oauth/token`);
    expect(metadata.registration_endpoint).toBe(`${baseUrl}/oauth/register`);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);

    const registration = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP Client",
        redirect_uris: ["http://127.0.0.1/callback"],
        scope: "vault:read",
      }),
    });
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string; token_endpoint_auth_method: string };
    expect(client.client_id).toBeTruthy();
    expect(client.client_id).toMatch(/^vault-mcp-client-[0-9a-f-]+$/);
    expect(client.token_endpoint_auth_method).toBe("none");

    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = await pkceChallenge(verifier);
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      scope: "vault:read",
      resource: `${baseUrl}/mcp`,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state-1",
      password: "authorize-me",
    });
    const authorize = await fetch(`${baseUrl}/oauth/authorize`, {
      method: "POST",
      body: authParams,
      redirect: "manual",
    });
    expect(authorize.status).toBe(302);
    const redirect = new URL(authorize.headers.get("location") ?? "");
    expect(redirect.searchParams.get("state")).toBe("state-1");
    const code = redirect.searchParams.get("code") ?? "";
    expect(code).toBeTruthy();

    const token = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1/callback",
        resource: `${baseUrl}/mcp`,
        code,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);
    const tokenBody = await token.json() as { access_token: string; refresh_token: string; token_type: string };
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.refresh_token).toBeTruthy();

    const replayedCode = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1/callback",
        resource: `${baseUrl}/mcp`,
        code,
        code_verifier: verifier,
      }),
    });
    expect(replayedCode.status).toBe(400);

    const tools = await mcp(baseUrl, tokenBody.access_token, 1, "tools/list", {});
    expect(tools.result.tools?.map((tool) => tool.name)).toEqual(["search", "fetch"]);

    const refresh = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        resource: `${baseUrl}/mcp`,
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as { access_token: string; refresh_token: string };
    expect(refreshBody.access_token).toBeTruthy();
    expect(refreshBody.refresh_token).toBeTruthy();

    const replayedRefresh = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        resource: `${baseUrl}/mcp`,
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(replayedRefresh.status).toBe(400);
  });
});

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
});

async function createStore(): Promise<{ store: JsonIndexStore; indexFile: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-server-test-"));
  const indexFile = path.join(dir, "index.json");
  return {
    store: new JsonIndexStore(indexFile),
    indexFile,
  };
}

function testConfig(indexFile: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1:0",
    mcpResourceUrl: "http://127.0.0.1:0/mcp",
    indexFile,
    databaseUrl: null,
    accessToken: "test-access",
    syncToken: "test-sync",
    allowedOrigins: ["http://127.0.0.1", "http://localhost"],
    oauth: null,
    ...overrides,
  };
}

function listen(app: ReturnType<typeof createApp>): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(server);
    });
  });
}

async function syncStatus(baseUrl: string, token: string, documents: VaultDocument[]): Promise<number> {
  const response = await fetch(`${baseUrl}/admin/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ documents }),
  });
  return response.status;
}

type JsonRpcTestResponse = {
  result: {
    tools?: Array<{ name: string }>;
    structuredContent?: any;
    isError?: boolean;
  };
};

async function mcp(baseUrl: string, token: string, id: number, method: string, params: unknown): Promise<JsonRpcTestResponse> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  expect(response.status).toBe(200);
  return response.json() as Promise<JsonRpcTestResponse>;
}

async function expectMcpSseProbe(baseUrl: string, token: string): Promise<void> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  await response.body?.cancel();
}

function fixtureDocument(overrides: {
  contentHash?: string;
  text?: string;
  updatedAt?: string;
} = {}): VaultDocument {
  return {
    id: "doc-1",
    title: "Vault MCP Connector",
    text: overrides.text ?? "Remote MCP connector content with citations.",
    url: "https://example.test/notes/doc-1",
    metadata: {
      path: "20 Projects/Vault MCP Connector/Project Home.md",
      heading: null,
      tags: ["type/project", "status/active"],
      status: "active",
      updated_at: overrides.updatedAt ?? "2026-06-08T00:00:00.000Z",
      content_hash: overrides.contentHash ?? "hash",
      obsidian_uri: "obsidian://open?vault=Test&file=20%20Projects%2FVault%20MCP%20Connector%2FProject%20Home.md",
      source_policy: {
        allowed: true,
        reason: "Allowed project home.",
        matched_rule: "allow-active-project-home",
      },
    },
  };
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}
