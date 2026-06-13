#!/usr/bin/env node
import process from "node:process";

const baseUrl = required("SMOKE_BASE_URL").replace(/\/$/, "");
const accessToken = process.env.SMOKE_ACCESS_TOKEN ?? process.env.MCP_ACCESS_TOKEN;
assert(accessToken, "SMOKE_ACCESS_TOKEN or MCP_ACCESS_TOKEN is required");
const syncToken = required("MCP_SYNC_TOKEN");
const fixtureVaultId = process.env.SMOKE_MULTI_VAULT_ID ?? "smoke-multivault";
const fallbackBaselineVaultId = "smoke-baseline";
const targetPath = "20 Projects/Vault MCP Connector/Multi Vault Smoke.md";
const fixtureDocumentId = "smoke-multivault-doc";
const baselineDocumentId = "smoke-baseline-doc";

await deleteVault(fixtureVaultId);
await deleteVault(fallbackBaselineVaultId);
const initialVaults = await listVaultIds();
const baselineVaultId = selectBaselineVaultId(initialVaults);
if (baselineVaultId === fallbackBaselineVaultId) {
  await syncBaselineVault();
}

try {
  await syncFixtureVault();

  const vaults = await mcp(1, "tools/call", {
    name: "list_vaults",
    arguments: {},
  });
  const vaultIds = vaults.result.structuredContent.vaults.map((vault) => vault.vault_id);
  assert(vaultIds.includes(fixtureVaultId), `expected ${fixtureVaultId} in list_vaults`);

  const unscoped = await mcp(2, "tools/call", {
    name: "search",
    arguments: { query: "smoke-multivault-unique", limit: 5 },
  });
  assert(unscoped.result.isError === true, "expected unscoped search to require vault_id when multiple vaults are connected");
  assert(unscoped.result.content?.[0]?.text?.includes("Pass vault_id"), "expected unscoped error to tell client to pass vault_id");

  const scopedFixtureSearch = await mcp(3, "tools/call", {
    name: "search",
    arguments: { query: "smoke-multivault-unique", vault_id: fixtureVaultId, limit: 5 },
  });
  assert(scopedFixtureSearch.result.structuredContent.results.length === 1, "expected fixture vault scoped search result");
  assert(scopedFixtureSearch.result.structuredContent.results[0].id === fixtureDocumentId, "expected fixture document id");
  assert(scopedFixtureSearch.result.structuredContent.results[0].vault_id === fixtureVaultId, "expected fixture result vault_id");

  const defaultSearch = await mcp(4, "tools/call", {
    name: "search",
    arguments: { query: "smoke-multivault-unique", vault_id: baselineVaultId, limit: 5 },
  });
  assert(defaultSearch.result.structuredContent.results.length === 0, "expected baseline vault scoped search not to see fixture vault content");

  const fetched = await mcp(5, "tools/call", {
    name: "fetch",
    arguments: { id: fixtureDocumentId, vault_id: fixtureVaultId },
  });
  assert(fetched.result.structuredContent.text.includes("smoke-multivault-unique"), "expected scoped fetch to return fixture text");

  const crossVaultFetch = await mcp(6, "tools/call", {
    name: "fetch",
    arguments: { id: fixtureDocumentId, vault_id: baselineVaultId },
  });
  assert(crossVaultFetch.result.isError === true, "expected baseline vault fetch of fixture id to fail");

  const fetchedByPath = await mcp(7, "tools/call", {
    name: "fetch_note_by_path",
    arguments: { path: targetPath, vault_id: fixtureVaultId },
  });
  assert(fetchedByPath.result.structuredContent.id === fixtureDocumentId, "expected scoped path fetch to return fixture document");

  const status = await mcp(8, "tools/call", {
    name: "get_vault_status",
    arguments: { vault_id: fixtureVaultId },
  });
  assert(status.result.structuredContent.vault_id === fixtureVaultId, "expected fixture vault status");
  assert(status.result.structuredContent.document_count === 1, "expected fixture vault document count");

  console.log(JSON.stringify({
    ok: true,
    fixture_vault_id: fixtureVaultId,
    baseline_vault_id: baselineVaultId,
    fixture_document_id: fixtureDocumentId,
  }, null, 2));
} finally {
  await deleteVault(fixtureVaultId);
  if (baselineVaultId === fallbackBaselineVaultId) {
    await deleteVault(fallbackBaselineVaultId);
  }
}

async function syncFixtureVault() {
  const response = await fetch(`${baseUrl}/admin/vaults/${encodeURIComponent(fixtureVaultId)}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      generated_at: new Date().toISOString(),
      manifest: {
        tenant_id: "default",
        vault_id: fixtureVaultId,
        installation_id: "smoke-installation",
        vault_name: "Smoke multi-vault fixture",
        generated_at: new Date().toISOString(),
        policy_version: "smoke-policy",
        index_mode: "manual_only",
        policy_summary: {
          include_prefixes: ["20 Projects/"],
          exclude_prefixes: [],
          manual_allow_paths: [targetPath],
          manual_allow_prefixes: [],
        },
      },
      stats: {
        scanned_markdown: 1,
        allowed_documents: 1,
        denied_markdown: 0,
        denied_by_rule: {},
      },
      documents: [fixtureDocument()],
    }),
  });
  const body = await response.text();
  assert(response.ok, `fixture vault sync failed: ${response.status} ${body}`);
}

async function syncBaselineVault() {
  const response = await fetch(`${baseUrl}/admin/vaults/${encodeURIComponent(fallbackBaselineVaultId)}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      generated_at: new Date().toISOString(),
      manifest: {
        tenant_id: "default",
        vault_id: fallbackBaselineVaultId,
        installation_id: "smoke-baseline-installation",
        vault_name: "Smoke baseline vault",
        generated_at: new Date().toISOString(),
        policy_version: "smoke-policy",
        index_mode: "manual_only",
        policy_summary: {
          include_prefixes: ["20 Projects/"],
          exclude_prefixes: [],
          manual_allow_paths: ["20 Projects/Vault MCP Connector/Baseline Smoke.md"],
          manual_allow_prefixes: [],
        },
      },
      stats: {
        scanned_markdown: 1,
        allowed_documents: 1,
        denied_markdown: 0,
        denied_by_rule: {},
      },
      documents: [baselineDocument()],
    }),
  });
  const body = await response.text();
  assert(response.ok, `baseline vault sync failed: ${response.status} ${body}`);
}

async function deleteVault(vaultId) {
  const response = await fetch(`${baseUrl}/admin/vaults/${encodeURIComponent(vaultId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  const body = await response.text();
  assert(response.ok, `delete vault ${vaultId} failed: ${response.status} ${body}`);
}

function fixtureDocument() {
  return {
    id: fixtureDocumentId,
    title: "Multi Vault Smoke",
    text: "This smoke-multivault-unique document belongs only to the temporary fixture vault.",
    url: `${baseUrl}/notes/${fixtureDocumentId}`,
    metadata: {
      path: targetPath,
      heading: null,
      tags: ["type/project", "status/active", "smoke/multivault"],
      status: "active",
      updated_at: new Date().toISOString(),
      content_hash: "smoke-multivault-hash",
      obsidian_uri: `obsidian://open?vault=Smoke&file=${encodeURIComponent(targetPath)}`,
      source_policy: {
        allowed: true,
        reason: "Remote multi-vault smoke fixture.",
        matched_rule: "manual-allow-path",
        policy_version: "smoke-policy",
        index_mode: "manual_only",
      },
    },
  };
}

function baselineDocument() {
  return {
    id: baselineDocumentId,
    title: "Baseline Smoke",
    text: "This smoke-baseline-unique document exists only to make multi-vault smoke self-contained.",
    url: `${baseUrl}/notes/${baselineDocumentId}`,
    metadata: {
      path: "20 Projects/Vault MCP Connector/Baseline Smoke.md",
      heading: null,
      tags: ["type/project", "status/active", "smoke/baseline"],
      status: "active",
      updated_at: new Date().toISOString(),
      content_hash: "smoke-baseline-hash",
      obsidian_uri: "obsidian://open?vault=Smoke&file=20%20Projects%2FVault%20MCP%20Connector%2FBaseline%20Smoke.md",
      source_policy: {
        allowed: true,
        reason: "Remote multi-vault smoke baseline fixture.",
        matched_rule: "manual-allow-path",
        policy_version: "smoke-policy",
        index_mode: "manual_only",
      },
    },
  };
}

async function listVaultIds() {
  const response = await fetch(`${baseUrl}/admin/vaults`, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  const body = await response.text();
  assert(response.ok, `list vaults failed: ${response.status} ${body}`);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed.vaults) ? parsed.vaults.map((vault) => vault.vault_id).filter(Boolean) : [];
}

function selectBaselineVaultId(initialVaults) {
  const requested = process.env.SMOKE_VAULT_ID;
  if (requested && initialVaults.includes(requested)) {
    return requested;
  }
  if (initialVaults.includes("default")) {
    return "default";
  }
  return initialVaults[0] ?? fallbackBaselineVaultId;
}

async function mcp(id, method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const body = await response.text();
  assert(response.ok, `expected ${method} to succeed: ${response.status} ${body}`);
  return JSON.parse(body);
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
