#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const strict = Boolean(args.strict) || args._[0] === "verify";
const distRoot = path.resolve(args.dir ?? path.join(repoRoot, "dist"));

const gates = [
  {
    key: "brat-ui",
    label: "BRAT copied-vault UI evidence",
    script: "scripts/status-brat-ui-evidence.mjs",
    scriptArgs: ["--dir", path.join(distRoot, "brat", "ui-evidence")],
    reportPath: path.join(distRoot, "brat", "ui-evidence", "report.json"),
    prepareCommand: "npm run plugin:brat:ready",
    verifyCommand: "npm run plugin:brat:verify-ui-evidence",
  },
  {
    key: "selfhost",
    label: "Fresh self-host evidence",
    script: "scripts/selfhost-evidence.mjs",
    scriptArgs: ["status", "--dir", path.join(distRoot, "selfhost")],
    reportPath: path.join(distRoot, "selfhost", "selfhost-report.json"),
    prepareCommand: "npm run selfhost:prepare",
    verifyCommand: "npm run selfhost:verify",
  },
  {
    key: "client-acceptance",
    label: "Real client acceptance evidence",
    script: "scripts/client-acceptance-evidence.mjs",
    scriptArgs: ["status", "--dir", path.join(distRoot, "acceptance")],
    reportPath: path.join(distRoot, "acceptance", "client-acceptance-report.json"),
    prepareCommand: "npm run acceptance:prepare",
    verifyCommand: "npm run acceptance:verify",
  },
  {
    key: "security-review",
    label: "Security/privacy review evidence",
    script: "scripts/security-review-evidence.mjs",
    scriptArgs: ["status", "--dir", path.join(distRoot, "security")],
    reportPath: path.join(distRoot, "security", "security-review-report.json"),
    prepareCommand: "npm run security:prepare",
    verifyCommand: "npm run security:verify",
  },
];

if (args.help || args._[0] === "help") {
  printHelp();
  process.exit(0);
}

const gateResults = [];
for (const gate of gates) {
  gateResults.push(await readGate(gate));
}

const complete = gateResults.every((gate) => gate.complete);
const output = {
  ok: !strict || complete,
  complete,
  status: complete ? "complete" : "incomplete",
  purpose: "Vault MCP release readiness evidence aggregate",
  distRoot,
  summary: {
    complete: gateResults.filter((gate) => gate.complete).length,
    total: gateResults.length,
    missingReports: gateResults.filter((gate) => gate.status === "missing_report").map((gate) => gate.key),
    incompleteGates: gateResults.filter((gate) => !gate.complete).map((gate) => gate.key),
  },
  gates: gateResults,
  nextActions: complete
    ? [
        "Run each strict verifier once more before changing release posture.",
        "Record the report paths and commit/deployment evidence in the project notes.",
      ]
    : gateResults
        .filter((gate) => !gate.complete)
        .flatMap((gate) => gate.nextActions.map((action) => `${gate.key}: ${action}`)),
};

console.log(JSON.stringify(output, null, 2));
if (strict && !complete) {
  process.exit(1);
}

async function readGate(gate) {
  if (!(await fileExists(gate.reportPath))) {
    return {
      key: gate.key,
      label: gate.label,
      complete: false,
      status: "missing_report",
      reportPath: gate.reportPath,
      prepareCommand: gate.prepareCommand,
      verifyCommand: gate.verifyCommand,
      failures: [`missing report: ${gate.reportPath}`],
      nextActions: [
        `Run ${gate.prepareCommand}.`,
        "Complete the evidence report without secrets.",
        `Run ${gate.verifyCommand}.`,
      ],
    };
  }

  const status = await runJson(process.execPath, [gate.script, ...gate.scriptArgs]);
  const failures = Array.isArray(status.failures) ? status.failures : [];
  return {
    key: gate.key,
    label: gate.label,
    complete: status.complete === true,
    status: status.status ?? (status.complete ? "complete" : "incomplete"),
    reportPath: status.reportPath ?? gate.reportPath,
    prepareCommand: gate.prepareCommand,
    verifyCommand: gate.verifyCommand,
    failures,
    nextActions: status.complete === true
      ? [`Run ${gate.verifyCommand} before release posture changes.`]
      : Array.isArray(status.nextActions) && status.nextActions.length > 0
        ? status.nextActions
        : [`Run ${gate.verifyCommand} after completing this evidence report.`],
  };
}

async function runJson(command, commandArgs) {
  const output = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}${stderr ? `\n${stderr}` : ""}`));
      }
    });
  });
  return JSON.parse(output);
}

async function fileExists(value) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--strict") {
      parsed.strict = true;
    } else if (arg === "--dir") {
      parsed.dir = argv[index + 1];
      index += 1;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/release-readiness-status.mjs [verify] [options]

Aggregates the local evidence reports for BRAT UI, fresh self-hosting, real
client acceptance, and security/privacy review.

Options:
  --dir <path>  Dist/evidence root. Defaults to dist.
  --strict      Exit non-zero unless every evidence gate is complete.
`);
}
