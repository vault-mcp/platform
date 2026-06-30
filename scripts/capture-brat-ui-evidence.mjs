#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
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
const report = await readReport(reportPath);
const screenshotMap = report.screenshots ?? {};
const keys = Object.keys(screenshotMap);

if (args.list) {
  printList(keys, screenshotMap, evidenceDir);
  process.exit(0);
}

const key = args.key;
if (!key) {
  console.error("Missing --key. Use --list to see valid screenshot keys.");
  process.exit(1);
}
if (!keys.includes(key)) {
  console.error(`Unknown screenshot key: ${key}`);
  printList(keys, screenshotMap, evidenceDir);
  process.exit(1);
}

const outputPath = screenshotPathForKey(key, screenshotMap, evidenceDir);
const mode = args.mode ?? "interactive";
if (!["interactive", "window", "screen"].includes(mode)) {
  throw new Error("--mode must be interactive, window, or screen");
}

await mkdir(path.dirname(outputPath), { recursive: true });

if (args["dry-run"]) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    key,
    mode,
    outputPath,
    nextAction: captureInstruction(mode),
  }, null, 2));
  process.exit(0);
}

if (process.platform !== "darwin") {
  console.error("Automatic screenshot capture is currently supported only on macOS.");
  console.error(`Save a PNG or JPG manually at: ${outputPath}`);
  process.exit(1);
}

await captureScreenshot(outputPath, mode);

console.log(JSON.stringify({
  ok: true,
  key,
  mode,
  outputPath,
  nextActions: [
    "Check the screenshot before sharing it.",
    "Make sure no GitHub token, sync token, OAuth password, or private note body is visible.",
    "Run npm run plugin:brat:evidence-status to see what remains.",
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

async function captureScreenshot(outputPath, mode) {
  const commandArgs = ["-x"];
  if (mode === "interactive") {
    commandArgs.push("-i");
  } else if (mode === "window") {
    commandArgs.push("-w");
  }
  commandArgs.push(outputPath);

  await new Promise((resolve, reject) => {
    const child = spawn("/usr/sbin/screencapture", commandArgs, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`screencapture exited with ${signal ?? code}`));
      }
    });
  });
}

function screenshotPathForKey(key, screenshotMap, dir) {
  const value = screenshotMap[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Screenshot entry for ${key} is missing or invalid`);
  }
  return path.resolve(path.isAbsolute(value) ? value : path.join(dir, value));
}

function printList(keys, screenshotMap, dir) {
  console.log("BRAT UI evidence screenshot keys:");
  for (const item of keys) {
    console.log(`- ${item}: ${screenshotPathForKey(item, screenshotMap, dir)}`);
  }
  console.log("\nExample:");
  console.log("npm run plugin:brat:capture -- --key vault-mcp-readiness");
}

function captureInstruction(mode) {
  if (mode === "window") {
    return "Click the Obsidian window to capture it.";
  }
  if (mode === "screen") {
    return "The full screen will be captured immediately.";
  }
  return "Drag to select a safe region, or press Space then click the Obsidian window.";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--list") {
      parsed.list = true;
    } else if (arg === "--dry-run") {
      parsed["dry-run"] = true;
    } else if (arg === "--key" || arg === "--mode" || arg === "--dir" || arg === "--report") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run plugin:brat:capture -- [options]

Captures one BRAT UI evidence screenshot to the filename expected by
dist/brat/ui-evidence/report.json.

Options:
  --list           List screenshot keys and output paths.
  --key <name>     Screenshot key to capture.
  --mode <mode>    interactive, window, or screen. Defaults to interactive.
  --dir <path>     Evidence directory. Defaults to dist/brat/ui-evidence.
  --report <path>  Report JSON path. Defaults to <dir>/report.json.
  --dry-run        Print the output path without capturing.

Examples:
  npm run plugin:brat:capture -- --list
  npm run plugin:brat:capture -- --key brat-repo-config
  npm run plugin:brat:capture -- --key vault-mcp-readiness --mode window
`);
}
