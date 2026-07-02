#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "acceptance"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "client-acceptance-report.json"));
const endpoint = args.endpoint ?? "https://vault-mcp-connector.vercel.app/mcp";

const clientRequirements = [
  {
    key: "mcp-inspector",
    label: "MCP Inspector",
    requiredChecks: [
      "connects",
      "toolsListReadOnly",
      "searchesVaultMcp",
      "fetchesResult",
      "deniesGuessedId",
      "deniesDeniedPath",
    ],
  },
  {
    key: "chatgpt",
    label: "ChatGPT",
    requiredChecks: [
      "connects",
      "toolsListReadOnly",
      "searchesVaultMcp",
      "fetchesResult",
      "deniesGuessedId",
      "deniesDeniedPath",
      "rendersMcpUiFirstTry",
      "rendersFetchedNoteCleanly",
    ],
  },
  {
    key: "codex",
    label: "Codex",
    requiredChecks: [
      "connects",
      "toolsListReadOnly",
      "searchesVaultMcp",
      "fetchesResult",
      "deniesGuessedId",
      "deniesDeniedPath",
    ],
  },
  {
    key: "claude-or-alt",
    label: "Claude or another non-OpenAI MCP client",
    requiredChecks: [
      "clientNameProvided",
      "connects",
      "toolsListReadOnly",
      "searchesVaultMcp",
      "fetchesResult",
      "deniesGuessedId",
      "deniesDeniedPath",
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
    purpose: "Vault MCP real client acceptance evidence",
    endpoint,
    createdAt: new Date().toISOString(),
    tester: "",
    release: {
      repo: "vault-mcp/platform",
      branch: "codex/vault-mcp-v2-platform-migration",
      commit: "",
      deploymentUrl: endpoint.replace(/\/mcp$/, ""),
    },
    instructions: [
      "Do not paste OAuth passwords, bearer tokens, sync tokens, GitHub tokens, private note bodies, or screenshots containing secrets into this report.",
      "Use evidenceRefs for screenshot paths, browser URLs, log file paths, PR/check URLs, or short non-secret notes.",
      "Mark a check true only after testing the real client, not after reading a local smoke result.",
    ],
    clients: Object.fromEntries(clientRequirements.map((client) => [client.key, clientTemplate(client)])),
    notes: [],
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    purpose: "prepared client acceptance evidence report",
    reportPath,
    evidenceDir,
    nextActions: [
      "Run the MCP Inspector, ChatGPT, Codex, and Claude/non-OpenAI client checks in docs/acceptance.md.",
      "Fill this report with non-secret evidence references.",
      "Run npm run acceptance:status, then npm run acceptance:verify.",
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
    purpose: "Vault MCP real client acceptance evidence status",
    reportPath,
    endpoint: report.endpoint ?? null,
    clients: clientRequirements.map((client) => clientStatus(report, client)),
    failures,
    nextActions: complete
      ? ["Record the completed report path, commit, deployment, and screenshot/log references in the project notes."]
      : [
          "Run every real-client check in docs/acceptance.md.",
          "Fill missing client checks with true only after real client testing.",
          "Add non-secret evidenceRefs for each client, especially screenshots/logs for ChatGPT UI first render and denied access.",
          "Run npm run acceptance:verify when status is complete.",
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
    throw new Error(`Could not read ${reportPath}. Run npm run acceptance:prepare first. ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

function clientTemplate(client) {
  return {
    label: client.label,
    testedAt: "",
    tester: "",
    authMode: "",
    clientName: client.key === "claude-or-alt" ? "" : client.label,
    checks: Object.fromEntries(client.requiredChecks.map((check) => [check, false])),
    evidenceRefs: [],
    notes: "",
  };
}

function clientStatus(report, client) {
  const entry = report.clients?.[client.key];
  const missing = clientFailures(entry, client);
  return {
    key: client.key,
    label: client.label,
    complete: missing.length === 0,
    missing,
  };
}

function reportFailures(report) {
  const failures = [];
  if (report.reportVersion !== 1) {
    failures.push("reportVersion must be 1");
  }
  if (typeof report.endpoint !== "string" || !/^https:\/\/.+\/mcp$/.test(report.endpoint)) {
    failures.push("endpoint must be an HTTPS MCP endpoint ending in /mcp");
  }
  if (typeof report.tester !== "string" || report.tester.trim().length === 0) {
    failures.push("tester is required");
  }
  if (typeof report.release?.commit !== "string" || report.release.commit.trim().length < 7) {
    failures.push("release.commit is required");
  }
  if (typeof report.release?.deploymentUrl !== "string" || !/^https:\/\/.+/.test(report.release.deploymentUrl)) {
    failures.push("release.deploymentUrl must be an HTTPS URL");
  }

  for (const client of clientRequirements) {
    for (const failure of clientFailures(report.clients?.[client.key], client)) {
      failures.push(`${client.key}: ${failure}`);
    }
  }

  for (const failure of secretScanFailures(report)) {
    failures.push(failure);
  }

  return failures;
}

function clientFailures(entry, client) {
  const failures = [];
  if (!entry || typeof entry !== "object") {
    return ["client entry is missing"];
  }
  if (typeof entry.testedAt !== "string" || entry.testedAt.trim().length === 0) {
    failures.push("testedAt is required");
  }
  if (typeof entry.tester !== "string" || entry.tester.trim().length === 0) {
    failures.push("tester is required");
  }
  if (typeof entry.authMode !== "string" || entry.authMode.trim().length === 0) {
    failures.push("authMode is required");
  }
  if (client.key === "claude-or-alt" && (typeof entry.clientName !== "string" || entry.clientName.trim().length === 0)) {
    failures.push("clientName is required");
  }
  for (const check of client.requiredChecks) {
    if (entry.checks?.[check] !== true) {
      failures.push(`${check} is not true`);
    }
  }
  if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0) {
    failures.push("evidenceRefs must include at least one non-secret screenshot/log/reference");
  }
  return failures;
}

function secretScanFailures(report) {
  const serialized = JSON.stringify(report);
  const patterns = [
    /github_pat_[A-Za-z0-9_]+/,
    /ghp_[A-Za-z0-9_]+/,
    /Bearer\s+(?!tokens?\b)[A-Za-z0-9._-]+/i,
    /MCP_SYNC_TOKEN/i,
    /OAUTH_AUTH_PASSWORD/i,
    /syncToken/i,
    /oauthPassword/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
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
    } else if (arg === "--dir" || arg === "--report" || arg === "--endpoint") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/client-acceptance-evidence.mjs <prepare|status|verify> [options]

Creates and verifies a structured real-client acceptance report for MCP
Inspector, ChatGPT, Codex, and Claude or another non-OpenAI MCP client.

Options:
  --dir <path>       Evidence directory. Defaults to dist/acceptance.
  --report <path>    Report path. Defaults to <dir>/client-acceptance-report.json.
  --endpoint <url>   MCP endpoint. Defaults to https://vault-mcp-connector.vercel.app/mcp.
  --force            Overwrite an existing report when preparing.
`);
}
