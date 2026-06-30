#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));
const vaultRoot = path.resolve(args.vault ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
const vaultKind = args["vault-kind"] ?? (vaultRoot.toLowerCase().includes("copy") ? "copied" : "disposable");
const repo = args.repo ?? "vault-mcp/platform";
const releaseTag = args.tag ?? readPackageVersionFallback();
const skipChecks = Boolean(args["skip-checks"]);

if (!["copied", "disposable"].includes(vaultKind)) {
  throw new Error("--vault-kind must be copied or disposable");
}
if (path.resolve(vaultRoot) === "/Users/tjt/Documents/Tristan's Personal vault") {
  throw new Error("Refusing to prepare BRAT UI evidence for the live vault");
}

await mkdir(evidenceDir, { recursive: true });

const commands = {
  "plugin:brat:verify-github": false,
  "plugin:brat:check-copy": false,
  "plugin:brat:verify-copy-install": false,
};

if (!skipChecks) {
  await run("npm", ["run", "plugin:brat:verify-github"], repoRoot);
  commands["plugin:brat:verify-github"] = true;

  await run("npm", ["run", "plugin:brat:check-copy", "--", "--check-github-release", "--vault", vaultRoot, "--repo", repo, "--tag", releaseTag], repoRoot);
  commands["plugin:brat:check-copy"] = true;

  await run("npm", ["run", "plugin:brat:verify-copy-install", "--", "--vault", vaultRoot, "--repo", repo, "--tag", releaseTag], repoRoot);
  commands["plugin:brat:verify-copy-install"] = true;
}

const screenshotNames = {
  "brat-repo-config": "brat-repo-config.png",
  "brat-install-update": "brat-install-update.png",
  "community-plugin-enabled": "community-plugin-enabled.png",
  "vault-mcp-readiness": "vault-mcp-readiness.png",
  "vault-mcp-check-connection": "vault-mcp-check-connection.png",
  "vault-mcp-preview-index": "vault-mcp-preview-index.png",
  "vault-mcp-sync-summary": "vault-mcp-sync-summary.png",
};

const report = {
  releaseTag,
  repo,
  vaultKind,
  vaultRoot,
  commands,
  screenshots: screenshotNames,
  notes: [
    "No token fields were visible in screenshots.",
    "Testing used the copied or disposable vault only.",
  ],
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  purpose: "prepared BRAT copied-vault UI evidence folder",
  evidenceDir,
  reportPath,
  releaseTag,
  repo,
  vaultKind,
  vaultRoot,
  skippedChecks: skipChecks,
  nextActions: [
    "Open the copied/disposable vault in Obsidian.",
    "Capture the seven screenshots named in report.json into the evidence directory.",
    "Run npm run plugin:brat:verify-ui-evidence.",
  ],
}, null, 2));

async function run(command, commandArgs, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dir" || arg === "--report" || arg === "--vault" || arg === "--vault-kind" || arg === "--repo" || arg === "--tag") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (arg === "--skip-checks") {
      parsed["skip-checks"] = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readPackageVersionFallback() {
  return process.env.npm_package_version ?? "0.1.0";
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:prepare-ui-evidence -- [options]

Runs prerequisite BRAT checks and writes a local report.json template for the
screenshot-backed BRAT UI evidence gate.

Options:
  --dir <path>        Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>     Report JSON path. Defaults to <dir>/report.json.
  --vault <path>      Copied or disposable vault root.
  --vault-kind <kind> copied or disposable. Inferred from the vault path when omitted.
  --repo <owner/repo> GitHub repo. Defaults to vault-mcp/platform.
  --tag <version>     Release tag. Defaults to npm package version.
  --skip-checks       Write the report template without running prerequisite checks.
`);
}
