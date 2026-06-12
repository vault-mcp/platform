#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { buildVaultIndex, defaultIndexPolicy, DEFAULT_INSTALLATION_ID, DEFAULT_TENANT_ID, DEFAULT_VAULT_ID, type IndexMode } from "@vault-mcp/core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const program = new Command();

program
  .name("vault-mcp-indexer")
  .description("Build or sync a read-only Vault MCP index from an allowlisted Obsidian vault.")
  .option("--vault <path>", "Vault root to scan", process.env.VAULT_ROOT ?? "/Users/tjt/Documents/Tristan's Personal vault copy")
  .option("--vault-name <name>", "Obsidian vault name used for obsidian:// URIs", process.env.VAULT_NAME)
  .option("--tenant-id <id>", "Tenant id for V2 multi-tenant sync payloads", process.env.VAULT_MCP_TENANT_ID ?? DEFAULT_TENANT_ID)
  .option("--vault-id <id>", "Vault id for V2 multi-vault sync payloads", process.env.VAULT_MCP_VAULT_ID ?? DEFAULT_VAULT_ID)
  .option("--installation-id <id>", "Plugin/CLI installation id for V2 sync payloads", process.env.VAULT_MCP_INSTALLATION_ID ?? DEFAULT_INSTALLATION_ID)
  .option("--index-mode <mode>", "Indexing mode: rules_plus_approvals, manual_only, or rules_only", process.env.VAULT_MCP_INDEX_MODE ?? "rules_plus_approvals")
  .option("--public-base-url <url>", "Private note URL base exposed in MCP metadata", process.env.PUBLIC_BASE_URL ?? "https://vault-mcp.local")
  .option("--out <path>", "Write index JSON to this file")
  .option("--report <path>", "Write a Markdown index report, relative to the vault root unless absolute")
  .option("--server <url>", "Server base URL to sync to, for example http://127.0.0.1:3333")
  .option("--sync-token <token>", "Admin sync token; defaults to MCP_SYNC_TOKEN env")
  .parse(process.argv);

const options = program.opts<{
  vault: string;
  vaultName?: string;
  tenantId: string;
  vaultId: string;
  installationId: string;
  indexMode: IndexMode;
  publicBaseUrl: string;
  out?: string;
  report?: string;
  server?: string;
  syncToken?: string;
}>();

const index = await buildVaultIndex({
  vaultRoot: options.vault,
  vaultName: options.vaultName,
  tenantId: options.tenantId,
  vaultId: options.vaultId,
  installationId: options.installationId,
  indexPolicy: defaultIndexPolicy(options.indexMode),
  publicBaseUrl: options.publicBaseUrl,
  reportPath: options.report,
});

if (options.out) {
  const outputPath = path.resolve(repoRoot, options.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

if (options.server) {
  const token = options.syncToken ?? process.env.MCP_SYNC_TOKEN;
  if (!token) {
    throw new Error("--sync-token or MCP_SYNC_TOKEN is required when --server is used.");
  }

  const response = await fetch(`${options.server.replace(/\/$/, "")}/admin/sync`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: options.tenantId,
      vault_id: options.vaultId,
      installation_id: options.installationId,
      vault_name: options.vaultName,
      policy_version: index.manifest?.policy_version,
      index_mode: options.indexMode,
      manifest: index.manifest,
      documents: index.documents,
      generated_at: index.generated_at,
      stats: index.stats,
    }),
  });

  if (!response.ok) {
    throw new Error(`Sync failed with ${response.status}: ${await response.text()}`);
  }
}

console.log(JSON.stringify({
  generated_at: index.generated_at,
  vault_root: index.vault_root,
  manifest: index.manifest,
  stats: index.stats,
}, null, 2));
