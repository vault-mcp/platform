#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  REQUIRED_BRAT_REVIEW_FLAGS,
  REQUIRED_BRAT_SCREENSHOTS,
  defaultScreenshotReview,
} from "./brat-ui-evidence-constants.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));

if (args.list) {
  printList();
  process.exit(0);
}

if (!args.key) {
  throw new Error("Missing --key. Use --list to see valid screenshot keys.");
}
if (!REQUIRED_BRAT_SCREENSHOTS.includes(args.key)) {
  throw new Error(`Unknown screenshot key: ${args.key}`);
}

const reviewer = args.reviewer ?? process.env.USER ?? "";
if (!reviewer.trim()) {
  throw new Error("Missing --reviewer. Provide a human reviewer name or initials.");
}

const report = await readReport(reportPath);
const existingReview = report.screenshotReview ?? defaultScreenshotReview();
const prior = existingReview[args.key] ?? {};

report.screenshotReview = {
  ...existingReview,
  [args.key]: {
    ...prior,
    matchesRequiredScreen: !args["not-required-screen"],
    copiedVaultOrSafeContext: !args["not-copied-vault"],
    noSecretsVisible: !args["secrets-visible"],
    reviewer: reviewer.trim(),
    reviewedAt: args["reviewed-at"] ?? new Date().toISOString(),
    notes: args.notes ?? prior.notes ?? "",
  },
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  purpose: "marked BRAT UI screenshot reviewed",
  reportPath,
  key: args.key,
  review: report.screenshotReview[args.key],
  nextActions: [
    "Run npm run plugin:brat:evidence-status to see what remains.",
    "Run npm run plugin:brat:verify-ui-evidence after all screenshots are captured and reviewed.",
  ],
}, null, 2));

async function readReport(value) {
  try {
    return JSON.parse(await readFile(value, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${value}. Run npm run plugin:brat:ready first. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function printList() {
  console.log("BRAT UI screenshot review keys:");
  for (const key of REQUIRED_BRAT_SCREENSHOTS) {
    console.log(`- ${key}`);
  }
  console.log("\nRequired review flags:");
  for (const flag of REQUIRED_BRAT_REVIEW_FLAGS) {
    console.log(`- ${flag}`);
  }
  console.log("\nExample:");
  console.log('npm run plugin:brat:review -- --key vault-mcp-readiness --reviewer "Tristan"');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--list") {
      parsed.list = true;
    } else if (["--key", "--reviewer", "--reviewed-at", "--notes", "--dir", "--report"].includes(arg)) {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (["--not-required-screen", "--not-copied-vault", "--secrets-visible"].includes(arg)) {
      parsed[arg.slice(2)] = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:review -- [options]

Marks one captured BRAT UI evidence screenshot as human-reviewed in report.json.
Only mark a screenshot reviewed after inspecting it.

Options:
  --list                 List valid screenshot keys.
  --key <name>           Screenshot key to mark reviewed.
  --reviewer <name>      Human reviewer name or initials. Defaults to $USER.
  --notes <text>         Optional review note.
  --reviewed-at <iso>    Override review timestamp.
  --not-required-screen  Mark that the screenshot does not match the required screen.
  --not-copied-vault     Mark that copied/disposable vault context is not visible or safe.
  --secrets-visible      Mark that a secret/private body content is visible.
  --dir <path>           Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>        Report JSON path. Defaults to <dir>/report.json.

Examples:
  npm run plugin:brat:review -- --list
  npm run plugin:brat:review -- --key brat-repo-config --reviewer "Tristan"
  npm run plugin:brat:review -- --key vault-mcp-readiness --notes "Safe region only"
`);
}
