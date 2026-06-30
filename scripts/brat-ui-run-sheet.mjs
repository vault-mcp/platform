#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { REQUIRED_BRAT_SCREENSHOTS } from "./brat-ui-evidence-constants.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const evidenceDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "ui-evidence"));
const reportPath = path.resolve(args.report ?? path.join(evidenceDir, "report.json"));
const reviewer = args.reviewer ?? "Tristan";
const report = await readReport(reportPath);
const format = args.format ?? "text";

if (!["text", "markdown"].includes(format)) {
  throw new Error("--format must be text or markdown");
}

const lines = format === "markdown" ? markdownRunSheet(report, reviewer) : textRunSheet(report, reviewer);
console.log(lines.join("\n"));

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

function textRunSheet(report, reviewer) {
  const vaultName = path.basename(report.vaultRoot ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
  const lines = [
    "Vault MCP BRAT UI evidence run sheet",
    "",
    `Release: ${report.releaseTag ?? "unknown"}`,
    `Repo: ${report.repo ?? "unknown"}`,
    `Vault: ${report.vaultRoot ?? "unknown"}`,
    `Evidence: ${evidenceDir}`,
    "",
    "Start:",
    "1. npm run plugin:brat:ready",
    `2. open "${obsidianVaultUrl(vaultName)}"`,
    "",
    "For each screenshot below:",
    "- Navigate Obsidian to the described UI state.",
    "- Run the capture command.",
    "- Inspect the saved image before marking it reviewed.",
    "- Run the review command only when it shows the required screen, copied/safe context, and no secrets.",
    "",
  ];

  let index = 1;
  for (const key of REQUIRED_BRAT_SCREENSHOTS) {
    lines.push(`${index}. ${key}`);
    lines.push(`   Purpose: ${screenshotPurpose(key)}`);
    lines.push(`   Capture: npm run plugin:brat:capture -- --key ${key}`);
    lines.push(`   Review:  npm run plugin:brat:review -- --key ${key} --reviewer "${reviewer}"`);
    lines.push("");
    index += 1;
  }

  lines.push("Finish:");
  lines.push("npm run plugin:brat:evidence-status");
  lines.push("npm run plugin:brat:verify-ui-evidence");
  return lines;
}

function markdownRunSheet(report, reviewer) {
  const vaultName = path.basename(report.vaultRoot ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
  const lines = [
    "# Vault MCP BRAT UI Evidence Run Sheet",
    "",
    `- Release: \`${report.releaseTag ?? "unknown"}\``,
    `- Repo: \`${report.repo ?? "unknown"}\``,
    `- Vault: \`${report.vaultRoot ?? "unknown"}\``,
    `- Evidence: \`${evidenceDir}\``,
    "",
    "## Start",
    "",
    "```bash",
    "npm run plugin:brat:ready",
    `open "${obsidianVaultUrl(vaultName)}"`,
    "```",
    "",
    "## Screenshots",
    "",
  ];

  for (const key of REQUIRED_BRAT_SCREENSHOTS) {
    lines.push(`### ${key}`);
    lines.push("");
    lines.push(screenshotPurpose(key));
    lines.push("");
    lines.push("```bash");
    lines.push(`npm run plugin:brat:capture -- --key ${key}`);
    lines.push(`npm run plugin:brat:review -- --key ${key} --reviewer "${reviewer}"`);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Finish");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run plugin:brat:evidence-status");
  lines.push("npm run plugin:brat:verify-ui-evidence");
  lines.push("```");
  return lines;
}

function screenshotPurpose(key) {
  const purposes = {
    "brat-repo-config": "BRAT shows vault-mcp/platform in its beta plugin list or repository configuration.",
    "brat-install-update": "BRAT install/update flow has completed or reports Vault MCP is current.",
    "community-plugin-enabled": "Obsidian Community plugins shows Vault MCP enabled.",
    "vault-mcp-readiness": "Vault MCP settings or dashboard shows the safety disclosure and readiness checklist.",
    "vault-mcp-check-connection": "Check connection has succeeded or shows a clearly actionable copied-vault failure.",
    "vault-mcp-preview-index": "Preview index shows allowed, denied, review-required, or redaction counts.",
    "vault-mcp-sync-summary": "A copied-vault sync summary is visible after syncing approved context.",
  };
  return purposes[key] ?? "Capture the required UI state for this evidence key.";
}

function obsidianVaultUrl(vaultName) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName).replaceAll("'", "%27")}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (["--dir", "--report", "--reviewer", "--format"].includes(arg)) {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:run-sheet -- [options]

Prints a human run sheet for the remaining copied-vault BRAT UI evidence pass.

Options:
  --dir <path>       Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>    Report JSON path. Defaults to <dir>/report.json.
  --reviewer <name>  Reviewer name used in review commands. Defaults to Tristan.
  --format <format>  text or markdown. Defaults to text.
`);
}
