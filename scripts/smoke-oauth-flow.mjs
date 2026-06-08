#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";

const baseUrl = required("SMOKE_BASE_URL").replace(/\/$/, "");
const password = required("SMOKE_OAUTH_PASSWORD");
const redirectUri = process.env.SMOKE_REDIRECT_URI ?? "http://127.0.0.1/callback";
const scope = process.env.SMOKE_OAUTH_SCOPE ?? "vault:read";
const resource = process.env.SMOKE_OAUTH_RESOURCE ?? `${baseUrl}/mcp`;

const metadata = await json(`${baseUrl}/.well-known/oauth-authorization-server`);
assert(metadata.authorization_endpoint === `${baseUrl}/oauth/authorize`, "expected self-hosted authorization endpoint");
assert(metadata.token_endpoint === `${baseUrl}/oauth/token`, "expected self-hosted token endpoint");
assert(metadata.registration_endpoint === `${baseUrl}/oauth/register`, "expected self-hosted registration endpoint");
assert(metadata.code_challenge_methods_supported?.includes("S256"), "expected S256 PKCE support");

const registration = await postJson(metadata.registration_endpoint, {
  client_name: "Vault MCP smoke client",
  redirect_uris: [redirectUri],
  scope,
});
assert(registration.client_id, "expected dynamic registration to return client_id");
assert(registration.token_endpoint_auth_method === "none", "expected public-client token auth");

const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = await fetch(metadata.authorization_endpoint, {
  method: "POST",
  redirect: "manual",
  body: new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope,
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "smoke-state",
    password,
  }),
});
assert(authorize.status === 302, `expected authorization redirect, got ${authorize.status} ${await authorize.text()}`);
const redirect = new URL(authorize.headers.get("location") ?? "");
assert(redirect.searchParams.get("state") === "smoke-state", "expected authorization redirect to preserve state");
const code = redirect.searchParams.get("code");
assert(code, "expected authorization redirect to include code");

const token = await postForm(metadata.token_endpoint, {
  grant_type: "authorization_code",
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  resource,
  code,
  code_verifier: verifier,
});
assert(token.access_token, "expected access token");
assert(token.refresh_token, "expected refresh token");
assert(token.token_type === "Bearer", "expected bearer token");

await expectFormError(metadata.token_endpoint, {
  grant_type: "authorization_code",
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  resource,
  code,
  code_verifier: verifier,
}, "expected authorization code replay to fail");

const refresh = await postForm(metadata.token_endpoint, {
  grant_type: "refresh_token",
  resource,
  refresh_token: token.refresh_token,
});
assert(refresh.access_token, "expected refreshed access token");
assert(refresh.refresh_token, "expected rotated refresh token");

await expectFormError(metadata.token_endpoint, {
  grant_type: "refresh_token",
  resource,
  refresh_token: token.refresh_token,
}, "expected refresh token replay to fail");

const smoke = spawnSync("npm", ["run", "smoke:remote"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SMOKE_BASE_URL: baseUrl,
    SMOKE_ACCESS_TOKEN: refresh.access_token,
    SMOKE_EXPECT_OAUTH: "true",
  },
});
if (smoke.status !== 0) {
  process.exit(smoke.status ?? 1);
}

console.log(JSON.stringify({
  ok: true,
  oauth_flow: "authorization_code_pkce",
  refresh: true,
  replay_protection: true,
  metadata_issuer: metadata.issuer,
  resource,
}, null, 2));

async function json(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function postForm(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const text = await response.text();
  assert(response.ok, `expected ${url} to succeed: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function expectFormError(url, values, message) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const text = await response.text();
  assert(response.status >= 400, `${message}: ${response.status} ${text}`);
}

function required(name) {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
