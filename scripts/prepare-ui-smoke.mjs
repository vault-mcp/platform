#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg("base-url", "SMOKE_BASE_URL", "PUBLIC_BASE_URL")?.replace(/\/$/, "") ?? "https://vault-mcp-connector.vercel.app";
const syncToken = stringArg("sync-token", "MCP_SYNC_TOKEN");
const vaultRoot = stringArg("vault-root", "VAULT_ROOT") ?? "/Users/tjt/Documents/Tristan's Personal vault copy";
const vaultId = stringArg("vault-id", "VAULT_ID") ?? "default";
const tenantId = stringArg("tenant-id", "TENANT_ID") ?? "default";
const installationId = stringArg("installation-id", "INSTALLATION_ID") ?? "obsidian-plugin-ui-smoke";
const runId = stringArg("run-id") ?? `ui-smoke-${compactTimestamp(new Date())}`;
const skipBuild = Boolean(args["skip-build"]);
const dryRun = Boolean(args["dry-run"]);

assert(syncToken, "--sync-token or MCP_SYNC_TOKEN is required");
assert(vaultRoot.includes("vault copy"), `Refusing to prepare UI smoke outside a copied vault: ${vaultRoot}`);

const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "vault-mcp");
const settingsPath = path.join(pluginDir, "data.json");
const settings = safeSmokeSettings();

if (!dryRun) {
  if (skipBuild) {
    await run("node", ["scripts/install-obsidian-plugin.mjs", "--skip-build", "--vault", vaultRoot], repoRoot);
  } else {
    await run("node", ["scripts/install-obsidian-plugin.mjs", "--vault", vaultRoot], repoRoot);
  }
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

const seedOutput = await runJson("node", [
  "scripts/seed-write-proposals.mjs",
  "--base-url",
  baseUrl,
  "--sync-token",
  syncToken,
  "--vault-root",
  vaultRoot,
  "--vault-id",
  vaultId,
  "--run-id",
  runId,
  ...(dryRun ? ["--dry-run"] : []),
], repoRoot);

let verifyOutput = null;
if (!dryRun) {
  verifyOutput = await runJson("node", [
    "scripts/verify-ui-smoke.mjs",
    "--base-url",
    baseUrl,
    "--sync-token",
    syncToken,
    "--vault-root",
    vaultRoot,
    "--vault-id",
    vaultId,
    "--run-id",
    runId,
    "--mode",
    "initial",
  ], repoRoot);
}

console.log(JSON.stringify({
  ok: true,
  dry_run: dryRun,
  base_url: baseUrl,
  vault_root: vaultRoot,
  vault_id: vaultId,
  run_id: runId,
  plugin_dir: pluginDir,
  settings_path: settingsPath,
  settings: {
    ...settings,
    syncToken: settings.syncToken ? "configured" : "",
  },
  seed: seedOutput,
  initial_verification: verifyOutput,
  next: [
    "Open the copied vault in Obsidian.",
    "Enable or reload the Vault MCP plugin.",
    "Run Vault MCP: Check server connection.",
    "Run Vault MCP: Open dashboard, then Review write proposals.",
    "Approve and apply each proposal.",
    `Run npm run plugin:verify-ui-smoke -- --base-url ${JSON.stringify(baseUrl)} --vault-root ${JSON.stringify(vaultRoot)} --vault-id ${JSON.stringify(vaultId)} --run-id ${JSON.stringify(runId)} --mode applied`,
  ],
}, null, 2));

function safeSmokeSettings() {
  return {
    serverUrl: baseUrl,
    syncToken,
    tenantId,
    vaultId,
    installationId,
    indexMode: "rules_plus_approvals",
    writeMode: "review_required",
    includePrefixes: ["00 System/Task Hub.md", "20 Projects/", "40 Reference/"],
    excludePrefixes: ["00 System/Credentials/", "02 Daily/", "Daily Notes/", "50 Areas/Finance/", "50 Areas/Identity/", "50 Areas/Legal/", "90 Archive/"],
    manualAllowPaths: [],
    manualAllowPrefixes: [],
    syncIntervalMinutes: 0,
    writeAuditFolder: "00 System/Vault MCP Write Audit",
    syncHistory: [{
      type: "server-check",
      message: `Prepared UI smoke run ${runId}. Run Check connection in Obsidian before reviewing proposals.`,
      createdAt: new Date().toISOString(),
    }],
  };
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

async function runJson(command, commandArgs, cwd) {
  const output = await run(command, commandArgs, cwd, "pipe");
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON output from ${command} ${commandArgs.join(" ")}. Output:\n${output}`);
  }
}

async function run(command, commandArgs, cwd, stdio = "inherit") {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
      shell: false,
    });
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}${stderr ? `\n${stderr}` : ""}`));
      }
    });
  });
}

function compactTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
