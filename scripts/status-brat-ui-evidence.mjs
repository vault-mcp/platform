#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { duplicateScreenshotFailures, inspectScreenshot } from "./brat-ui-evidence-utils.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));
const strict = Boolean(args.strict);
const expectedTag = args.tag ?? readPackageVersionFallback();
const expectedRepo = args.repo ?? "vault-mcp/platform";
const liveVaultRoot = "/Users/tjt/Documents/Tristan's Personal vault";
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

const reportResult = await readReport(reportPath);
const checks = [];
const missingScreenshots = [];
const invalidScreenshots = [];
const presentScreenshots = [];
const failures = [];

if (!reportResult.ok) {
  failures.push(reportResult.error);
} else {
  const report = reportResult.report;
  checks.push(check("release tag", report.releaseTag === expectedTag, `expected ${expectedTag}`, report.releaseTag));
  checks.push(check("repo", report.repo === expectedRepo, `expected ${expectedRepo}`, report.repo));
  checks.push(check("vault kind", report.vaultKind === "copied" || report.vaultKind === "disposable", "copied or disposable", report.vaultKind));
  checks.push(check("vault root", typeof report.vaultRoot === "string" && report.vaultRoot.length > 0, "non-empty vault path", report.vaultRoot));
  checks.push(check("not live vault", path.resolve(report.vaultRoot ?? "") !== liveVaultRoot, "must not be live vault", report.vaultRoot));
  if (report.vaultKind === "copied") {
    checks.push(check("copied-vault path", String(report.vaultRoot).toLowerCase().includes("copy"), "path visibly contains copy", report.vaultRoot));
  }

  for (const commandName of requiredCommands) {
    checks.push(check(commandName, report.commands?.[commandName] === true, "true", report.commands?.[commandName]));
  }

  for (const key of requiredScreenshots) {
    const value = report.screenshots?.[key];
    const screenshotPath = typeof value === "string" && value.length > 0
      ? path.resolve(path.isAbsolute(value) ? value : path.join(evidenceDir, value))
      : null;
    const inspection = screenshotPath ? await inspectScreenshot(screenshotPath) : null;
    if (inspection?.ok) {
      presentScreenshots.push({
        key,
        path: screenshotPath,
        size: inspection.size,
        dimensions: inspection.dimensions,
        sha256: inspection.sha256,
      });
    } else if (inspection && inspection.issues.some((issue) => issue.startsWith("missing screenshot"))) {
      missingScreenshots.push({ key, expectedPath: screenshotPath ?? path.join(evidenceDir, `${key}.png`) });
    } else if (inspection) {
      invalidScreenshots.push({
        key,
        path: screenshotPath,
        issues: inspection.issues,
        size: inspection.size ?? null,
        dimensions: inspection.dimensions ?? null,
      });
    } else {
      missingScreenshots.push({ key, expectedPath: screenshotPath ?? path.join(evidenceDir, `${key}.png`) });
    }
  }

  failures.push(...duplicateScreenshotFailures(presentScreenshots));

  for (const failure of secretScanFailures(report)) {
    failures.push(failure);
  }

  for (const item of checks) {
    if (!item.ok) {
      failures.push(`${item.name}: expected ${item.expected}; received ${item.actual}`);
    }
  }
}

const complete = reportResult.ok && failures.length === 0 && missingScreenshots.length === 0 && invalidScreenshots.length === 0;
const status = complete
  ? "complete"
  : reportResult.ok
    ? invalidScreenshots.length > 0
      ? "invalid_screenshots"
      : "waiting_for_screenshots"
    : "missing_or_invalid_report";
const output = {
  ok: true,
  complete,
  status,
  purpose: "BRAT copied-vault UI evidence status",
  evidenceDir,
  reportPath,
  checks,
  screenshots: {
    required: requiredScreenshots.length,
    present: presentScreenshots,
    invalid: invalidScreenshots,
    missing: missingScreenshots,
  },
  failures,
  nextActions: complete
    ? ["Run npm run plugin:brat:verify-ui-evidence for the strict final gate."]
    : reportResult.ok
      ? [
          "Capture the missing screenshots into the expected paths.",
          "Replace any invalid screenshots with readable PNG/JPEG files.",
          "Avoid token fields and private note content in screenshots.",
          "Run npm run plugin:brat:verify-ui-evidence after all screenshots are present.",
        ]
      : [
          "Run npm run plugin:brat:prepare-ui-evidence to create the report scaffold.",
          "Then capture the seven screenshots named in the report.",
        ],
};

console.log(JSON.stringify(output, null, 2));

if (strict && !complete) {
  process.exit(1);
}

async function readReport(value) {
  try {
    return { ok: true, report: JSON.parse(await readFile(value, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Could not read evidence report: ${error.message}` : "Could not read evidence report",
    };
  }
}

function check(name, ok, expected, actual) {
  return {
    name,
    ok,
    expected,
    actual: actual ?? null,
  };
}

function secretScanFailures(report) {
  const serialized = JSON.stringify(report);
  const patterns = [
    /github_pat_[A-Za-z0-9_]+/,
    /ghp_[A-Za-z0-9_]+/,
    /Bearer\s+[A-Za-z0-9._-]+/i,
    /MCP_SYNC_TOKEN/i,
    /OAUTH_AUTH_PASSWORD/i,
    /syncToken/i,
    /oauthPassword/i,
  ];
  return patterns
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => `report appears to contain a secret-like value matching ${pattern}`);
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
    } else if (arg === "--strict") {
      parsed.strict = true;
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
  console.log(`Usage: npm run plugin:brat:evidence-status -- [options]

Reports the current BRAT screenshot evidence status without failing by default.

Options:
  --dir <path>       Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>    Report JSON path. Defaults to <dir>/report.json.
  --tag <version>    Expected release tag. Defaults to npm package version.
  --repo <owner/repo> Expected GitHub repo. Defaults to vault-mcp/platform.
  --strict           Exit non-zero unless all evidence is complete.
`);
}
