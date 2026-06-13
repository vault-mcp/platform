#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg("base-url", "SMOKE_BASE_URL", "PUBLIC_BASE_URL")?.replace(/\/$/, "");
const syncToken = stringArg("sync-token", "MCP_SYNC_TOKEN");
const vaultRoot = stringArg("vault-root", "VAULT_ROOT") ?? "/Users/tjt/Documents/Tristan's Personal vault copy";
const vaultId = stringArg("vault-id", "VAULT_ID") ?? "default";
const runId = stringArg("run-id");
const mode = stringArg("mode") ?? "initial";

assert(baseUrl, "--base-url, SMOKE_BASE_URL, or PUBLIC_BASE_URL is required");
assert(syncToken, "--sync-token or MCP_SYNC_TOKEN is required");
assert(runId, "--run-id is required");
assert(["initial", "applied"].includes(mode), "--mode must be initial or applied");
assert(vaultRoot.includes("vault copy"), `Refusing to verify UI smoke outside a copied vault: ${vaultRoot}`);

const fixturePrefix = `20 Projects/Vault MCP Connector/Plugin UI Smoke/${runId}`;
const paths = {
  append: `${fixturePrefix}/Append Target.md`,
  replace: `${fixturePrefix}/Replace Target.md`,
  frontmatter: `${fixturePrefix}/Frontmatter Target.md`,
  renameBefore: `${fixturePrefix}/Rename Target.md`,
  renameAfter: `${fixturePrefix}/Renamed By Proposal.md`,
  created: `${fixturePrefix}/Created From Proposal.md`,
};

const proposals = await fetchSeededProposals();
const byOperation = new Map(proposals.map((proposal) => [proposal.operation, proposal]));
for (const operation of ["create_note", "append_to_note", "replace_note", "update_frontmatter", "rename_note"]) {
  assert(byOperation.has(operation), `Missing seeded ${operation} proposal for ${runId}`);
}

if (mode === "initial") {
  for (const proposal of proposals) {
    assert(proposal.status === "pending", `Expected ${proposal.operation} to be pending, got ${proposal.status}`);
  }
  assert(await read(paths.created) === null, "Create target should not exist before apply");
  assert(await read(paths.append) === "# Append Target\n\nThis note should receive one appended line.\n", "Append target is not in initial state");
  assert(await read(paths.replace) === "# Replace Target\n\nThis content should be replaced by the proposal.\n", "Replace target is not in initial state");
  assert((await read(paths.frontmatter))?.includes("remove_me: yes"), "Frontmatter target is not in initial state");
  assert(await read(paths.renameBefore) === "# Rename Target\n\nThis note should be renamed by the proposal.\n", "Rename source is not in initial state");
  assert(await read(paths.renameAfter) === null, "Rename destination should not exist before apply");
}

if (mode === "applied") {
  for (const proposal of proposals) {
    assert(proposal.status === "applied", `Expected ${proposal.operation} to be applied, got ${proposal.status}`);
  }
  assert(await read(paths.created) === "# Created From Proposal\n\nThis note was created from a seeded Vault MCP write proposal.\n", "Create target was not created");
  assert((await read(paths.append))?.includes("- Appended by a seeded Vault MCP write proposal."), "Append target was not appended");
  assert(await read(paths.replace) === "# Replaced Target\n\nThis note was replaced from a seeded Vault MCP write proposal.\n", "Replace target was not replaced");
  const frontmatter = await read(paths.frontmatter);
  assert(frontmatter?.includes("status: active"), "Frontmatter target status was not updated");
  assert(!frontmatter?.includes("remove_me:"), "Frontmatter target still contains remove_me");
  assert(await read(paths.renameBefore) === null, "Rename source still exists after apply");
  assert(await read(paths.renameAfter) === "# Rename Target\n\nThis note should be renamed by the proposal.\n", "Rename destination was not created");
  const auditFiles = await listAuditFiles();
  for (const proposal of proposals) {
    assert(auditFiles.some((file) => file.content.includes(`Proposal id: \`${proposal.id}\``)), `Missing audit note for ${proposal.operation} ${proposal.id}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode,
  base_url: baseUrl,
  vault_root: vaultRoot,
  vault_id: vaultId,
  run_id: runId,
  proposal_statuses: proposals.map((proposal) => ({
    id: proposal.id,
    operation: proposal.operation,
    status: proposal.status,
    target_path: proposal.target_path,
  })),
}, null, 2));

async function fetchSeededProposals() {
  const response = await fetch(`${baseUrl}/admin/vaults/${encodeURIComponent(vaultId)}/write-proposals`, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  const body = await response.text();
  assert(response.ok, `Failed to fetch proposals: ${response.status} ${body}`);
  const parsed = JSON.parse(body);
  return parsed.proposals.filter((proposal) => proposal.requester === `plugin-ui-seed:${runId}`);
}

async function read(relativePath) {
  try {
    return await fs.readFile(path.join(vaultRoot, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listAuditFiles() {
  const auditRoot = path.join(vaultRoot, "00 System/Vault MCP Write Audit");
  const files = [];
  await walk(auditRoot, files);
  return files;
}

async function walk(dir, files) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.name.endsWith("-audit.md")) {
      files.push({ path: fullPath, content: await fs.readFile(fullPath, "utf8") });
    }
  }
}

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
