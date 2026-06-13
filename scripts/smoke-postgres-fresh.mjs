#!/usr/bin/env node
import pg from "pg";
import { PostgresIndexStore } from "../apps/server/dist/store.js";

const configuredDatabaseUrl = process.env.POSTGRES_SMOKE_DATABASE_URL ?? process.env.POSTGRES_FRESH_DATABASE_URL;
assert(configuredDatabaseUrl, "POSTGRES_SMOKE_DATABASE_URL or POSTGRES_FRESH_DATABASE_URL is required");
const databaseUrl = normalizeSslMode(configuredDatabaseUrl);

const schema = `vault_mcp_fresh_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
assert(/^[a-z][a-z0-9_]+$/.test(schema), `unsafe generated schema name: ${schema}`);

const adminPool = new pg.Pool({ connectionString: databaseUrl });
let store;

try {
  await adminPool.query(`create schema ${quoteIdentifier(schema)}`);
  store = new PostgresIndexStore(withSearchPath(withUnpooledConnection(databaseUrl), schema));
  await store.load();

  const generatedAt = new Date().toISOString();
  await store.replace({
    tenant_id: "fresh-tenant",
    vault_id: "fresh-vault",
    installation_id: "fresh-installation",
    vault_name: "Fresh Boot Smoke Vault",
    policy_version: "fresh-smoke-policy",
    index_mode: "rules_plus_approvals",
    generated_at: generatedAt,
    manifest: {
      tenant_id: "fresh-tenant",
      vault_id: "fresh-vault",
      installation_id: "fresh-installation",
      vault_name: "Fresh Boot Smoke Vault",
      generated_at: generatedAt,
      policy_version: "fresh-smoke-policy",
      index_mode: "rules_plus_approvals",
      policy_summary: {
        allowed_rules: ["20 Projects/"],
        denied_rules: ["02 Daily/"],
        review_rules: [],
      },
    },
    documents: [{
      id: "fresh-doc",
      tenant_id: "fresh-tenant",
      vault_id: "fresh-vault",
      installation_id: "fresh-installation",
      title: "Fresh Boot Smoke",
      text: "Fresh Postgres boot smoke document.",
      url: "https://vault-mcp.example.test/notes/fresh-doc",
      obsidian_uri: "obsidian://open?vault=Fresh%20Boot%20Smoke%20Vault&file=20%20Projects%2FFresh%20Boot.md",
      metadata: {
        tenant_id: "fresh-tenant",
        vault_id: "fresh-vault",
        installation_id: "fresh-installation",
        path: "20 Projects/Fresh Boot.md",
        heading: null,
        note_title: "Fresh Boot Smoke",
        chunk_index: 0,
        tags: ["topic/mcp"],
        status: "active",
        updated_at: generatedAt,
        content_hash: "fresh-content-hash",
        obsidian_uri: "obsidian://open?vault=Fresh%20Boot%20Smoke%20Vault&file=20%20Projects%2FFresh%20Boot.md",
        source_policy: {
          allowed: true,
          reason: "Fresh boot smoke fixture.",
          matched_rule: "fresh-smoke",
          policy_version: "fresh-smoke-policy",
          index_mode: "rules_plus_approvals",
        },
      },
    }],
    stats: {
      scanned_markdown: 1,
      allowed_documents: 1,
      denied_markdown: 0,
      denied_by_rule: {},
      review_required_markdown: 0,
      reviewed_by_rule: {},
      redacted_documents: 0,
      redactions_by_pattern: {},
    },
  });

  const health = await store.health();
  assert(health.storage.kind === "postgres", "expected Postgres storage health");
  assert(health.storage.ok === true, "expected storage health ok");
  assert(health.storage.migrations?.includes("0001_initial_vault_mcp_schema"), "expected initial migration id in health");
  assert(health.document_count === 1, `expected 1 document, got ${health.document_count}`);
  assert(health.vault_count === 1, `expected 1 vault, got ${health.vault_count}`);
  assert(health.last_sync_at === generatedAt, "expected health last_sync_at to match fixture sync");

  const vaults = await store.listVaults();
  assert(vaults.length === 1, `expected 1 vault summary, got ${vaults.length}`);
  assert(vaults[0].vault_id === "fresh-vault", `expected fresh-vault, got ${vaults[0].vault_id}`);

  const fetched = await store.fetch("fresh-doc", "fresh-vault");
  assert(fetched?.title === "Fresh Boot Smoke", "expected fresh document fetch to work");

  console.log(JSON.stringify({
    ok: true,
    schema,
    storage: health.storage,
    document_count: health.document_count,
    vault_count: health.vault_count,
    last_sync_at: health.last_sync_at,
  }, null, 2));
} finally {
  await store?.close?.();
  await adminPool.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`).catch((error) => {
    console.error(`Failed to drop smoke schema ${schema}:`, error);
  });
  await adminPool.end();
}

function withSearchPath(connectionString, schemaName) {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${schemaName}`;
  url.searchParams.set("options", existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption);
  return url.toString();
}

function withUnpooledConnection(connectionString) {
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

function normalizeSslMode(connectionString) {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
