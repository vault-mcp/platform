#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { REQUIRED_BRAT_REVIEW_FLAGS, REQUIRED_BRAT_SCREENSHOTS } from "./brat-ui-evidence-constants.mjs";
import { duplicateScreenshotFailures, inspectScreenshot } from "./brat-ui-evidence-utils.mjs";
import { readPluginManifestVersion } from "./brat-manifest-version.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));
const strict = Boolean(args.strict);
const expectedTag = args.tag ?? await readPluginManifestVersion(repoRoot);
const expectedRepo = args.repo ?? "vault-mcp/platform";
const liveVaultRoot = "/Users/tjt/Documents/Tristan's Personal vault";
const requiredCommands = [
  "plugin:brat:verify-github",
  "plugin:brat:check-copy",
  "plugin:brat:verify-copy-install",
];
const requiredScreenshots = REQUIRED_BRAT_SCREENSHOTS;

const reportResult = await readReport(reportPath);
const checks = [];
const missingScreenshots = [];
const invalidScreenshots = [];
const presentScreenshots = [];
const incompleteReviews = [];
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
    const reviewIssues = screenshotReviewIssues(report.screenshotReview?.[key]);
    if (reviewIssues.length > 0) {
      incompleteReviews.push({ key, issues: reviewIssues });
    }

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

const complete = reportResult.ok
  && failures.length === 0
  && missingScreenshots.length === 0
  && invalidScreenshots.length === 0
  && incompleteReviews.length === 0;
const failedChecks = checks.filter((item) => !item.ok);
const status = complete
  ? "complete"
  : reportResult.ok
    ? failedChecks.length > 0
      ? "waiting_for_prerequisites"
      : invalidScreenshots.length > 0
        ? "invalid_screenshots"
        : missingScreenshots.length > 0
          ? "waiting_for_screenshots"
          : "waiting_for_review"
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
  reviews: {
    requiredFlags: REQUIRED_BRAT_REVIEW_FLAGS,
    incomplete: incompleteReviews,
  },
  failures,
  nextActions: complete
    ? ["Run npm run plugin:brat:verify-ui-evidence for the strict final gate."]
    : reportResult.ok
      ? nextActionsForStatus(status)
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

function screenshotReviewIssues(review) {
  const issues = [];
  if (!review || typeof review !== "object") {
    return ["missing review entry"];
  }
  for (const flag of REQUIRED_BRAT_REVIEW_FLAGS) {
    if (review[flag] !== true) {
      issues.push(`${flag} is not true`);
    }
  }
  if (typeof review.reviewer !== "string" || review.reviewer.trim().length === 0) {
    issues.push("reviewer is missing");
  }
  if (typeof review.reviewedAt !== "string" || review.reviewedAt.trim().length === 0) {
    issues.push("reviewedAt is missing");
  }
  return issues;
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

function nextActionsForStatus(value) {
  if (value === "waiting_for_prerequisites") {
    return [
      "Run npm run plugin:brat:ready without --skip-checks so GitHub release, copied-vault config, and installed-file checks pass.",
      "If the copied vault is not configured yet, run npm run plugin:brat:check-copy -- --enable-brat --add-repo --check-github-release.",
      "Only capture screenshots after the prerequisite command checks are true.",
    ];
  }
  if (value === "invalid_screenshots") {
    return [
      "Replace invalid screenshots with readable PNG/JPEG files at the expected paths.",
      "Inspect each replacement before marking it reviewed.",
      "Run npm run plugin:brat:evidence-status again.",
    ];
  }
  if (value === "waiting_for_screenshots") {
    return [
      "Capture the missing screenshots into the expected paths.",
      "Avoid token fields and private note content in screenshots.",
      "Inspect each screenshot and mark it reviewed with npm run plugin:brat:review.",
      "Run npm run plugin:brat:verify-ui-evidence after all screenshots are present.",
    ];
  }
  return [
    "Inspect each screenshot and mark it reviewed with npm run plugin:brat:review.",
    "Confirm every review says it shows the required screen, copied/safe context, and no secrets.",
    "Run npm run plugin:brat:verify-ui-evidence.",
  ];
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

function printHelp() {
  console.log(`Usage: npm run plugin:brat:evidence-status -- [options]

Reports the current BRAT screenshot evidence status without failing by default.

Options:
  --dir <path>       Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>    Report JSON path. Defaults to <dir>/report.json.
  --tag <version>    Expected release tag. Defaults to the Obsidian plugin manifest version.
  --repo <owner/repo> Expected GitHub repo. Defaults to vault-mcp/platform.
  --strict           Exit non-zero unless all evidence is complete.
`);
}
