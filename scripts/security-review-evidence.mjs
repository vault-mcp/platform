#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "security"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "security-review-report.json"));

const reviewAreas = [
  {
    key: "oauth",
    label: "OAuth and client authorization",
    requiredChecks: [
      "authorizationCodePkceReviewed",
      "refreshRotationReviewed",
      "dynamicRegistrationReviewed",
      "clientRevocationStoryDocumented",
    ],
  },
  {
    key: "origins",
    label: "CORS, origins, and OAuth forms",
    requiredChecks: [
      "allowedOriginsReviewed",
      "forbiddenOriginBehaviorReviewed",
      "productionSelfOriginReviewed",
      "browserAdjacentFlowsReviewed",
    ],
  },
  {
    key: "syncAdmin",
    label: "Sync and admin boundary",
    requiredChecks: [
      "syncTokenScopeReviewed",
      "adminEndpointsRequireSyncToken",
      "syncTokenRotationDocumented",
      "serverCannotReadVaultDirectly",
    ],
  },
  {
    key: "tenantVaultIsolation",
    label: "Tenant, vault, and installation isolation",
    requiredChecks: [
      "documentsScoped",
      "syncEventsScoped",
      "sessionsScoped",
      "statusesScoped",
      "writeProposalsScoped",
      "crossVaultLeakageTestsReviewed",
    ],
  },
  {
    key: "indexingPolicy",
    label: "Indexing policy, redaction, and denied access",
    requiredChecks: [
      "denyRulesPrecedeAllowRules",
      "manualApprovalsReviewed",
      "redactionStatsReviewed",
      "deniedIdsReviewed",
      "deniedPathsReviewed",
      "policyProvenanceReviewed",
    ],
  },
  {
    key: "writeSafety",
    label: "Write proposal safety",
    requiredChecks: [
      "proposalStateTransitionsReviewed",
      "baseHashConflictsReviewed",
      "backupsReviewed",
      "auditNotesReviewed",
      "directApplyMarkedExperimental",
      "writesRemainPrivateAlpha",
    ],
  },
  {
    key: "dataBoundary",
    label: "Data boundary and user-facing disclosures",
    requiredChecks: [
      "whatLeavesVaultDocumented",
      "whatStaysLocalDocumented",
      "knownLimitationsDocumented",
      "privatePathsNotPublicReleaseBlockerReviewed",
    ],
  },
  {
    key: "recovery",
    label: "Recovery and rollback",
    requiredChecks: [
      "rotateSyncTokenDocumented",
      "rotateOauthSecretDocumented",
      "revokeClientsDocumented",
      "deleteServerVaultDocumented",
      "rebuildIndexDocumented",
      "restoreBackupDocumented",
      "uninstallPluginDocumented",
    ],
  },
];

if (!command || args.help || command === "help") {
  printHelp();
  process.exit(args.help || command === "help" ? 0 : 1);
}

if (command === "prepare") {
  await prepareReport();
} else if (command === "status") {
  await printStatus(false);
} else if (command === "verify") {
  await printStatus(true);
} else {
  throw new Error(`Unknown command: ${command}`);
}

async function prepareReport() {
  await mkdir(evidenceDir, { recursive: true });
  if (!args.force) {
    const existing = await readFile(reportPath, "utf8").catch(() => null);
    if (existing) {
      throw new Error(`Refusing to overwrite existing report without --force: ${reportPath}`);
    }
  }

  const report = {
    reportVersion: 1,
    purpose: "Vault MCP release security and privacy review",
    createdAt: new Date().toISOString(),
    reviewer: "",
    reviewedAt: "",
    release: {
      repo: "vault-mcp/platform",
      branch: "codex/vault-mcp-v2-platform-migration",
      commit: "",
      deploymentUrl: "https://vault-mcp-connector.vercel.app",
    },
    documentsReviewed: [
      "docs/threat-model.md",
      "docs/self-host.md",
      "docs/plugin-private-alpha.md",
      "docs/acceptance.md",
      "docs/v2-migration.md",
    ],
    instructions: [
      "Do not paste OAuth passwords, bearer values, sync tokens, GitHub tokens, database URLs, or private note bodies into this report.",
      "Use evidenceRefs for commits, test output files, screenshots with secrets hidden, PR/check URLs, or short non-secret notes.",
      "Mark a check true only after reviewing the current implementation and docs.",
    ],
    areas: Object.fromEntries(reviewAreas.map((area) => [area.key, areaTemplate(area)])),
    decision: {
      privateAlphaAcceptable: false,
      publicReleaseAcceptable: false,
      writeToolsPubliclyAcceptable: false,
      summary: "",
    },
    notes: [],
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    purpose: "prepared security review evidence report",
    reportPath,
    evidenceDir,
    nextActions: [
      "Review the current implementation and docs for each security area.",
      "Fill this report with non-secret evidence references.",
      "Run npm run security:status, then npm run security:verify.",
    ],
  }, null, 2));
}

async function printStatus(strict) {
  const report = await readReport();
  const failures = reportFailures(report);
  const complete = failures.length === 0;
  const output = {
    ok: !strict || complete,
    complete,
    status: complete ? "complete" : "incomplete",
    purpose: "Vault MCP release security and privacy review status",
    reportPath,
    reviewedAt: report.reviewedAt ?? null,
    areas: reviewAreas.map((area) => areaStatus(report, area)),
    failures,
    nextActions: complete
      ? ["Record the completed report path, release commit, and security decision in the project notes."]
      : [
          "Review each incomplete security area against the current implementation and docs.",
          "Mark checks true only when current evidence supports them.",
          "Add non-secret evidenceRefs for each area.",
          "Keep publicReleaseAcceptable and writeToolsPubliclyAcceptable false unless the review explicitly clears them.",
          "Run npm run security:verify when status is complete.",
        ],
  };
  console.log(JSON.stringify(output, null, 2));
  if (strict && !complete) {
    process.exit(1);
  }
}

async function readReport() {
  try {
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${reportPath}. Run npm run security:prepare first. ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

function areaTemplate(area) {
  return {
    label: area.label,
    checks: Object.fromEntries(area.requiredChecks.map((check) => [check, false])),
    evidenceRefs: [],
    notes: "",
  };
}

function areaStatus(report, area) {
  const entry = report.areas?.[area.key];
  const missing = areaFailures(entry, area);
  return {
    key: area.key,
    label: area.label,
    complete: missing.length === 0,
    missing,
  };
}

function reportFailures(report) {
  const failures = [];
  if (report.reportVersion !== 1) {
    failures.push("reportVersion must be 1");
  }
  if (typeof report.reviewer !== "string" || report.reviewer.trim().length === 0) {
    failures.push("reviewer is required");
  }
  if (typeof report.reviewedAt !== "string" || report.reviewedAt.trim().length === 0) {
    failures.push("reviewedAt is required");
  }
  if (typeof report.release?.commit !== "string" || report.release.commit.trim().length < 7) {
    failures.push("release.commit is required");
  }
  if (typeof report.release?.deploymentUrl !== "string" || !/^https:\/\/.+/.test(report.release.deploymentUrl)) {
    failures.push("release.deploymentUrl must be an HTTPS URL");
  }
  if (!Array.isArray(report.documentsReviewed) || report.documentsReviewed.length === 0) {
    failures.push("documentsReviewed must list reviewed docs");
  }

  for (const area of reviewAreas) {
    for (const failure of areaFailures(report.areas?.[area.key], area)) {
      failures.push(`${area.key}: ${failure}`);
    }
  }

  if (report.decision?.privateAlphaAcceptable !== true) {
    failures.push("decision.privateAlphaAcceptable must be true for this gate to pass");
  }
  if (report.decision?.publicReleaseAcceptable === true) {
    failures.push("decision.publicReleaseAcceptable should remain false until public docs/demo data/release posture are complete");
  }
  if (report.decision?.writeToolsPubliclyAcceptable === true) {
    failures.push("decision.writeToolsPubliclyAcceptable should remain false until write tools pass a public-release review");
  }
  if (typeof report.decision?.summary !== "string" || report.decision.summary.trim().length === 0) {
    failures.push("decision.summary is required");
  }

  for (const failure of secretScanFailures(report)) {
    failures.push(failure);
  }

  return failures;
}

function areaFailures(entry, area) {
  const failures = [];
  if (!entry || typeof entry !== "object") {
    return ["area entry is missing"];
  }
  for (const check of area.requiredChecks) {
    if (entry.checks?.[check] !== true) {
      failures.push(`${check} is not true`);
    }
  }
  if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0) {
    failures.push("evidenceRefs must include at least one non-secret reference");
  }
  return failures;
}

function secretScanFailures(report) {
  const serialized = JSON.stringify(report);
  const patterns = [
    /github_pat_[A-Za-z0-9_]+/,
    /ghp_[A-Za-z0-9_]+/,
    /Bearer\s+(?!values?\b)[A-Za-z0-9._-]+/i,
    /postgres(?:ql)?:\/\/[^"'\s]+/i,
    /DATABASE_URL\s*[:=]\s*[^"'\s]+/i,
    /sync[_-]?token\s*[:=]\s*[^"'\s]+/i,
    /oauth[_-]?password\s*[:=]\s*[^"'\s]+/i,
    /access[_-]?token\s*[:=]\s*[^"'\s]+/i,
    /refresh[_-]?token\s*[:=]\s*[^"'\s]+/i,
  ];
  return patterns
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => `report appears to contain a secret-like value matching ${pattern}`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--dir" || arg === "--report") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/security-review-evidence.mjs <prepare|status|verify> [options]

Creates and verifies a structured release security/privacy review report.

Options:
  --dir <path>       Evidence directory. Defaults to dist/security.
  --report <path>    Report path. Defaults to <dir>/security-review-report.json.
  --force            Overwrite an existing report when preparing.
`);
}
