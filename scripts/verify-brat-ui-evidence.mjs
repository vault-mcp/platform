#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceManifest = JSON.parse(
  await readFile(path.join(repoRoot, "apps", "obsidian-plugin", "manifest.json"), "utf8"),
);
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));
const expectedTag = args.tag ?? sourceManifest.version;
const expectedRepo = args.repo ?? "vault-mcp/platform";
const requiredCommands = [
  "plugin:brat:verify-github",
  "plugin:brat:check-copy",
  "plugin:brat:verify-copy-install",
];
const requiredScreenshots = [
  "brat-repo-config",
  "brat-install-update",
  "community-plugin-enabled",
  "vault-mcp-readiness",
  "vault-mcp-check-connection",
  "vault-mcp-preview-index",
  "vault-mcp-sync-summary",
];

const report = JSON.parse(await readFile(reportPath, "utf8"));
const failures = [];

assertEqual(report.releaseTag, expectedTag, "report.releaseTag");
assertEqual(report.repo, expectedRepo, "report.repo");
assert(
  report.vaultKind === "copied" || report.vaultKind === "disposable",
  "report.vaultKind must be copied or disposable",
);
assert(typeof report.vaultRoot === "string" && report.vaultRoot.length > 0, "report.vaultRoot is required");
assert(
  path.resolve(report.vaultRoot) !== "/Users/tjt/Documents/Tristan's Personal vault",
  "evidence must not be captured against the live vault",
);
if (report.vaultKind === "copied") {
  assert(report.vaultRoot.toLowerCase().includes("copy"), "copied-vault evidence path should visibly be a copy");
}

for (const command of requiredCommands) {
  assert(report.commands?.[command] === true, `report.commands.${command} must be true`);
}

for (const key of requiredScreenshots) {
  const value = report.screenshots?.[key];
  assert(typeof value === "string" && value.length > 0, `report.screenshots.${key} is required`);
  if (typeof value === "string" && value.length > 0) {
    const screenshotPath = path.isAbsolute(value) ? value : path.join(evidenceDir, value);
    await assertScreenshot(screenshotPath, key);
  }
}

const serializedReport = JSON.stringify(report);
const forbiddenPatterns = [
  /github_pat_[A-Za-z0-9_]+/,
  /ghp_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /MCP_SYNC_TOKEN/i,
  /OAUTH_AUTH_PASSWORD/i,
  /syncToken/i,
  /oauthPassword/i,
];
for (const pattern of forbiddenPatterns) {
  assert(!pattern.test(serializedReport), `report appears to contain a secret-like value matching ${pattern}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, reportPath, evidenceDir, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  purpose: "BRAT copied-vault UI evidence verifier",
  reportPath,
  evidenceDir,
  releaseTag: report.releaseTag,
  repo: report.repo,
  vaultKind: report.vaultKind,
  vaultRoot: report.vaultRoot,
  verifiedCommands: requiredCommands,
  verifiedScreenshots: requiredScreenshots,
}, null, 2));

async function assertScreenshot(screenshotPath, key) {
  const result = await stat(screenshotPath).catch(() => null);
  assert(result?.isFile(), `${key} screenshot is missing: ${screenshotPath}`);
  assert(result?.size > 100, `${key} screenshot is too small to be useful: ${screenshotPath}`);
  const extension = path.extname(screenshotPath).toLowerCase();
  assert([".png", ".jpg", ".jpeg"].includes(extension), `${key} screenshot must be PNG or JPEG: ${screenshotPath}`);
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} must be ${expected}; received ${actual}`);
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dir" || arg === "--report" || arg === "--tag" || arg === "--repo") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:verify-ui-evidence -- [options]

Verifies a screenshot-backed BRAT UI evidence report.

Options:
  --dir <path>       Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>    Report JSON path. Defaults to <dir>/report.json.
  --tag <version>    Expected release tag. Defaults to the plugin manifest version.
  --repo <owner/repo> Expected GitHub repo. Defaults to vault-mcp/platform.
`);
}
