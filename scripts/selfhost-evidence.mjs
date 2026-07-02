#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "selfhost"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "selfhost-report.json"));
const defaultBaseUrl = args["base-url"] ?? "https://vault-mcp.example.com";

const evidenceSections = [
  {
    key: "localBuild",
    label: "Local build and tests",
    requiredChecks: [
      "npmCiCompleted",
      "buildPassed",
      "apiCheckPassed",
      "testsPassed",
    ],
  },
  {
    key: "database",
    label: "Database and migrations",
    requiredChecks: [
      "databaseProvisioned",
      "migrationsApplied",
      "freshPostgresSmokePassed",
      "databaseUrlNotRecorded",
    ],
  },
  {
    key: "deployment",
    label: "Vercel deployment",
    requiredChecks: [
      "projectLinked",
      "envVarsConfigured",
      "productionDeployCompleted",
      "productionUrlRecorded",
    ],
  },
  {
    key: "health",
    label: "Health and OAuth metadata",
    requiredChecks: [
      "healthzOk",
      "storageOk",
      "oauthProtectedResourceOk",
      "oauthAuthorizationServerOk",
      "noSecretsInHealthOutput",
    ],
  },
  {
    key: "sync",
    label: "Copied or disposable vault sync",
    requiredChecks: [
      "testVaultUsed",
      "liveVaultNotUsed",
      "previewOrPolicyReviewed",
      "syncCompleted",
      "documentCountNonZero",
    ],
  },
  {
    key: "remoteSmoke",
    label: "Remote smoke and multi-vault scoping",
    requiredChecks: [
      "oauthFlowSmokePassed",
      "refreshRotationPassed",
      "replayProtectionPassed",
      "multiVaultSmokePassed",
      "deniedGuessedIdPassed",
      "deniedPathPassed",
    ],
  },
  {
    key: "clientHandoff",
    label: "Client handoff values",
    requiredChecks: [
      "mcpEndpointRecorded",
      "oauthProviderRecorded",
      "syncTokenNotSharedWithClients",
      "clientAcceptanceNextStepRecorded",
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
    purpose: "Vault MCP fresh self-host deployment evidence",
    createdAt: new Date().toISOString(),
    tester: "",
    testedAt: "",
    baseUrl: defaultBaseUrl,
    release: {
      repo: "vault-mcp/platform",
      branch: "codex/vault-mcp-v2-platform-migration",
      commit: "",
    },
    hosting: {
      provider: "vercel",
      database: "neon-postgres",
      deploymentUrl: defaultBaseUrl,
      projectRef: "",
    },
    instructions: [
      "Use a fresh Vercel + Neon path or explicitly record that this is an existing-project rerun.",
      "Do not paste DATABASE_URL, MCP_SYNC_TOKEN, OAuth passwords, bearer values, GitHub tokens, or private note bodies into this report.",
      "Use evidenceRefs for non-secret command output files, deployment/check URLs, screenshots with secrets hidden, or short notes.",
    ],
    sections: Object.fromEntries(evidenceSections.map((section) => [section.key, sectionTemplate(section)])),
    outcome: {
      freshSelfHostVerified: false,
      existingProjectRerunOnly: false,
      summary: "",
    },
    notes: [],
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    purpose: "prepared self-host evidence report",
    reportPath,
    evidenceDir,
    nextActions: [
      "Follow docs/self-host.md from a fresh Vercel + Neon path or mark this as an existing-project rerun.",
      "Fill this report with non-secret evidence references.",
      "Run npm run selfhost:status, then npm run selfhost:verify.",
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
    purpose: "Vault MCP fresh self-host deployment evidence status",
    reportPath,
    baseUrl: report.baseUrl ?? null,
    sections: evidenceSections.map((section) => sectionStatus(report, section)),
    failures,
    nextActions: complete
      ? ["Record the completed report path, release commit, deployment URL, and smoke evidence in the project notes."]
      : [
          "Complete each missing self-host evidence section from docs/self-host.md.",
          "Add non-secret evidenceRefs for command outputs, deployment/check URLs, or screenshots with secrets hidden.",
          "Keep existingProjectRerunOnly false unless this was not a fresh Vercel + Neon path.",
          "Run npm run selfhost:verify when status is complete.",
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
    throw new Error(`Could not read ${reportPath}. Run npm run selfhost:prepare first. ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

function sectionTemplate(section) {
  return {
    label: section.label,
    checks: Object.fromEntries(section.requiredChecks.map((check) => [check, false])),
    evidenceRefs: [],
    notes: "",
  };
}

function sectionStatus(report, section) {
  const entry = report.sections?.[section.key];
  const missing = sectionFailures(entry, section);
  return {
    key: section.key,
    label: section.label,
    complete: missing.length === 0,
    missing,
  };
}

function reportFailures(report) {
  const failures = [];
  if (report.reportVersion !== 1) {
    failures.push("reportVersion must be 1");
  }
  if (typeof report.tester !== "string" || report.tester.trim().length === 0) {
    failures.push("tester is required");
  }
  if (typeof report.testedAt !== "string" || report.testedAt.trim().length === 0) {
    failures.push("testedAt is required");
  }
  if (typeof report.baseUrl !== "string" || !/^https:\/\/.+/.test(report.baseUrl)) {
    failures.push("baseUrl must be an HTTPS URL");
  }
  if (typeof report.release?.commit !== "string" || report.release.commit.trim().length < 7) {
    failures.push("release.commit is required");
  }
  if (typeof report.hosting?.deploymentUrl !== "string" || !/^https:\/\/.+/.test(report.hosting.deploymentUrl)) {
    failures.push("hosting.deploymentUrl must be an HTTPS URL");
  }
  if (typeof report.hosting?.projectRef !== "string" || report.hosting.projectRef.trim().length === 0) {
    failures.push("hosting.projectRef is required");
  }

  for (const section of evidenceSections) {
    for (const failure of sectionFailures(report.sections?.[section.key], section)) {
      failures.push(`${section.key}: ${failure}`);
    }
  }

  if (report.outcome?.freshSelfHostVerified !== true) {
    failures.push("outcome.freshSelfHostVerified must be true for this gate to pass");
  }
  if (report.outcome?.existingProjectRerunOnly === true) {
    failures.push("outcome.existingProjectRerunOnly must be false for fresh self-host verification");
  }
  if (typeof report.outcome?.summary !== "string" || report.outcome.summary.trim().length === 0) {
    failures.push("outcome.summary is required");
  }

  for (const failure of secretScanFailures(report)) {
    failures.push(failure);
  }

  return failures;
}

function sectionFailures(entry, section) {
  const failures = [];
  if (!entry || typeof entry !== "object") {
    return ["section entry is missing"];
  }
  for (const check of section.requiredChecks) {
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
    /MCP_SYNC_TOKEN\s*[:=]\s*[^"'\s]+/i,
    /OAUTH_AUTH_PASSWORD\s*[:=]\s*[^"'\s]+/i,
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
    } else if (arg === "--dir" || arg === "--report" || arg === "--base-url") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/selfhost-evidence.mjs <prepare|status|verify> [options]

Creates and verifies a structured fresh self-host deployment evidence report.

Options:
  --dir <path>       Evidence directory. Defaults to dist/selfhost.
  --report <path>    Report path. Defaults to <dir>/selfhost-report.json.
  --base-url <url>   Public base URL. Defaults to https://vault-mcp.example.com.
  --force            Overwrite an existing report when preparing.
`);
}
