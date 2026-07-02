#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { readPluginManifestVersion } from "./brat-manifest-version.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const copiedVaultRoot = path.resolve(args.vault ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
const repo = args.repo ?? "vault-mcp/platform";
const tag = args.tag ?? await readPluginManifestVersion(repoRoot);
const liveVaultRoot = "/Users/tjt/Documents/Tristan's Personal vault";

if (copiedVaultRoot === liveVaultRoot) {
  throw new Error("Refusing to run BRAT readiness against the live vault");
}

console.log("Vault MCP BRAT readiness\n");
console.log(`Release: ${tag}`);
console.log(`Repo:    ${repo}`);
console.log(`Vault:   ${copiedVaultRoot}`);
console.log(`Output:  ${evidenceDir}\n`);

await run("npm", [
  "run",
  "plugin:brat:prepare-ui-evidence",
  "--",
  "--dir",
  evidenceDir,
  "--vault",
  copiedVaultRoot,
  "--repo",
  repo,
  "--tag",
  tag,
]);

const status = await runJson("npm", [
  "run",
  "plugin:brat:evidence-status",
  "--",
  "--dir",
  evidenceDir,
  "--repo",
  repo,
  "--tag",
  tag,
]);

printSummary(status, copiedVaultRoot, evidenceDir);

async function run(command, commandArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function runJson(command, commandArgs) {
  let stdout = "";
  let stderr = "";
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}\n${stderr}`));
      }
    });
  });

  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Expected JSON output from ${command} ${commandArgs.join(" ")}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
}

function printSummary(status, vaultRoot, dir) {
  const missing = status.screenshots?.missing ?? [];
  const commandFailures = (status.checks ?? []).filter((check) => !check.ok);

  console.log("\nBRAT readiness summary");
  console.log(`Status: ${status.status}`);
  console.log(`Prerequisite checks: ${commandFailures.length === 0 ? "passed" : "failed"}`);
  console.log(`Screenshots: ${(status.screenshots?.present ?? []).length}/${status.screenshots?.required ?? 0}`);

  if (commandFailures.length > 0) {
    console.log("\nFix these before opening Obsidian:");
    for (const failure of commandFailures) {
      console.log(`- ${failure.name}: expected ${failure.expected}; received ${failure.actual}`);
    }
    return;
  }

  if (status.complete) {
    console.log("\nReady to close the BRAT UI evidence gate:");
    console.log("npm run plugin:brat:verify-ui-evidence");
    return;
  }

  console.log("\nReady for your manual copied-vault BRAT pass.");
  console.log("Open the copied vault, capture the missing screenshots below, then run:");
  console.log("npm run plugin:brat:verify-ui-evidence");
  console.log("\nOpen copied vault:");
  console.log(`open "${obsidianVaultUrl(vaultRoot)}"`);
  console.log("\nMissing screenshots:");
  for (const item of missing) {
    console.log(`- ${item.key}: ${path.relative(dir, item.expectedPath)}`);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dir" || arg === "--vault" || arg === "--repo" || arg === "--tag") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function obsidianVaultUrl(vaultRoot) {
  const vaultName = encodeURIComponent(path.basename(vaultRoot)).replaceAll("'", "%27");
  return `obsidian://open?vault=${vaultName}`;
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:ready -- [options]

Runs the GitHub release, copied-vault BRAT config, copied-vault installed-file,
and UI-evidence status checks in one place.

Options:
  --dir <path>        Evidence directory. Defaults to dist/brat/ui-evidence.
  --vault <path>      Copied or disposable vault root.
  --repo <owner/repo> GitHub repo. Defaults to vault-mcp/platform.
  --tag <version>     Release tag. Defaults to the Obsidian plugin manifest version.
`);
}
