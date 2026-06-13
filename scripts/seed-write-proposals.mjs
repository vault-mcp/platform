#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg("base-url", "SMOKE_BASE_URL", "PUBLIC_BASE_URL")?.replace(/\/$/, "");
const syncToken = stringArg("sync-token", "MCP_SYNC_TOKEN");
const vaultRoot = stringArg("vault-root", "VAULT_ROOT") ?? "/Users/tjt/Documents/Tristan's Personal vault copy";
const vaultId = stringArg("vault-id", "VAULT_ID") ?? "default";
const runId = stringArg("run-id") ?? new Date().toISOString().replace(/[:.]/g, "-");
const dryRun = Boolean(args["dry-run"]);

assert(baseUrl, "--base-url, SMOKE_BASE_URL, or PUBLIC_BASE_URL is required");
assert(syncToken, "--sync-token or MCP_SYNC_TOKEN is required");
assert(vaultRoot.includes("vault copy"), `Refusing to seed write fixtures outside a copied vault: ${vaultRoot}`);

const fixturePrefix = `20 Projects/Vault MCP Connector/Plugin UI Smoke/${runId}`;
const fixtures = {
  appendTarget: {
    path: `${fixturePrefix}/Append Target.md`,
    content: "# Append Target\n\nThis note should receive one appended line.\n",
  },
  replaceTarget: {
    path: `${fixturePrefix}/Replace Target.md`,
    content: "# Replace Target\n\nThis content should be replaced by the proposal.\n",
  },
  frontmatterTarget: {
    path: `${fixturePrefix}/Frontmatter Target.md`,
    content: "---\nstatus: draft\nremove_me: yes\ntags:\n  - topic/mcp\n---\n# Frontmatter Target\n\nThis body should stay intact.\n",
  },
  renameTarget: {
    path: `${fixturePrefix}/Rename Target.md`,
    content: "# Rename Target\n\nThis note should be renamed by the proposal.\n",
  },
};

if (!dryRun) {
  await fs.mkdir(path.join(vaultRoot, fixturePrefix), { recursive: true });
  for (const fixture of Object.values(fixtures)) {
    await fs.writeFile(path.join(vaultRoot, fixture.path), fixture.content, "utf8");
  }
}

const proposals = [
  {
    operation: "create_note",
    target_path: `${fixturePrefix}/Created From Proposal.md`,
    proposed_content: "# Created From Proposal\n\nThis note was created from a seeded Vault MCP write proposal.\n",
  },
  {
    operation: "append_to_note",
    target_path: fixtures.appendTarget.path,
    base_content_hash: sha256Hex(fixtures.appendTarget.content),
    proposed_content: "\n- Appended by a seeded Vault MCP write proposal.\n",
  },
  {
    operation: "replace_note",
    target_path: fixtures.replaceTarget.path,
    base_content_hash: sha256Hex(fixtures.replaceTarget.content),
    proposed_content: "# Replaced Target\n\nThis note was replaced from a seeded Vault MCP write proposal.\n",
  },
  {
    operation: "update_frontmatter",
    target_path: fixtures.frontmatterTarget.path,
    base_content_hash: sha256Hex(fixtures.frontmatterTarget.content),
    proposed_content: JSON.stringify({
      status: "active",
      reviewed: true,
      remove_me: null,
      tags: ["topic/mcp", "status/active", "test/plugin-ui"],
    }),
  },
  {
    operation: "rename_note",
    target_path: fixtures.renameTarget.path,
    base_content_hash: sha256Hex(fixtures.renameTarget.content),
    proposed_content: `${fixturePrefix}/Renamed By Proposal.md`,
  },
];

const created = [];
for (const proposal of proposals) {
  if (dryRun) {
    created.push({ dry_run: true, ...proposal });
    continue;
  }
  const response = await fetch(`${baseUrl}/admin/vaults/${encodeURIComponent(vaultId)}/write-proposals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...proposal,
      requester: `plugin-ui-seed:${runId}`,
    }),
  });
  const body = await response.text();
  assert(response.ok, `Failed to create ${proposal.operation} proposal: ${response.status} ${body}`);
  const parsed = JSON.parse(body);
  created.push({
    id: parsed.proposal.id,
    operation: parsed.proposal.operation,
    target_path: parsed.proposal.target_path,
    status: parsed.proposal.status,
  });
}

console.log(JSON.stringify({
  ok: true,
  dry_run: dryRun,
  base_url: baseUrl,
  vault_root: vaultRoot,
  vault_id: vaultId,
  run_id: runId,
  fixture_prefix: fixturePrefix,
  proposals: created,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function stringArg(name, ...envNames) {
  const fromArg = args[name];
  if (typeof fromArg === "string" && fromArg.length > 0) {
    return fromArg;
  }
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value) {
      return value;
    }
  }
  return null;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
