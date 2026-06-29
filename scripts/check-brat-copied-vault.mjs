#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(args.vault ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
const repo = args.repo ?? "vault-mcp/platform";
const tag = args.tag ?? sourceManifest.version;
const enableBrat = Boolean(args["enable-brat"]);
const addRepo = Boolean(args["add-repo"]);
const checkGitHubRelease = Boolean(args["check-github-release"]);
const writeReportPath = args["write-report"] ? path.resolve(args["write-report"]) : null;
const obsidianDir = path.join(vaultRoot, ".obsidian");
const pluginsDir = path.join(obsidianDir, "plugins");
const bratPluginId = "obsidian42-brat";
const bratDir = path.join(pluginsDir, bratPluginId);
const bratManifestPath = path.join(bratDir, "manifest.json");
const bratDataPath = path.join(bratDir, "data.json");
const communityPluginsPath = path.join(obsidianDir, "community-plugins.json");

await assertDirectory(vaultRoot, "vault root");
await assertDirectory(obsidianDir, ".obsidian directory");
await assertDirectory(pluginsDir, "Obsidian plugins directory");
await assertFile(bratManifestPath, "BRAT manifest");
await assertFile(bratDataPath, "BRAT data");
await assertFile(communityPluginsPath, "community plugins list");

const bratManifest = JSON.parse(await readFile(bratManifestPath, "utf8"));
const bratData = JSON.parse(await readFile(bratDataPath, "utf8"));
const communityPlugins = JSON.parse(await readFile(communityPluginsPath, "utf8"));

assert(Array.isArray(communityPlugins), "community-plugins.json must be a JSON array");
assert(Array.isArray(bratData.pluginList), "BRAT data pluginList must be a JSON array");
assert(Array.isArray(bratData.pluginSubListFrozenVersion), "BRAT data pluginSubListFrozenVersion must be a JSON array");

const before = inspectState({ bratManifest, bratData, communityPlugins });
let changedCommunityPlugins = false;
let changedBratData = false;

if (enableBrat && !communityPlugins.includes(bratPluginId)) {
  communityPlugins.push(bratPluginId);
  communityPlugins.sort();
  changedCommunityPlugins = true;
}

if (addRepo) {
  if (!bratData.pluginList.includes(repo)) {
    bratData.pluginList.push(repo);
    changedBratData = true;
  }

  const frozenEntry = bratData.pluginSubListFrozenVersion.find((entry) => entry?.repo === repo);
  if (!frozenEntry) {
    bratData.pluginSubListFrozenVersion.push({ repo, version: tag });
    changedBratData = true;
  } else if (frozenEntry.version !== tag) {
    frozenEntry.version = tag;
    changedBratData = true;
  }
}

if (changedCommunityPlugins) {
  await writeFile(communityPluginsPath, `${JSON.stringify(communityPlugins, null, 2)}\n`, "utf8");
}
if (changedBratData) {
  await writeFile(bratDataPath, `${JSON.stringify(bratData, null, 2)}\n`, "utf8");
}

const after = inspectState({ bratManifest, bratData, communityPlugins });
const githubRelease = checkGitHubRelease ? await verifyGitHubRelease(repo, tag) : null;
const githubRepo = await readGitHubRepo(repo);
const blocks = [];

if (!after.bratInstalled) {
  blocks.push("BRAT plugin files are missing from the copied vault");
}
if (!after.bratCompatible) {
  blocks.push(`BRAT version ${after.bratVersion ?? "unknown"} is below the supported release-asset flow`);
}
if (!after.bratEnabled) {
  blocks.push("BRAT is installed but not enabled in .obsidian/community-plugins.json");
}
if (!after.repoConfigured) {
  blocks.push(`BRAT is not configured to track ${repo}`);
}
if (githubRepo?.visibility === "PRIVATE" && !after.hasPersonalAccessToken) {
  blocks.push("The GitHub repo is private and BRAT has no personal access token configured");
}
if (githubRelease && !githubRelease.ok) {
  blocks.push("The GitHub BRAT prerelease verifier failed");
}

const report = {
  ok: blocks.length === 0,
  purpose: "copied-vault BRAT readiness check",
  vaultRoot,
  repo,
  tag,
  githubRepo,
  githubRelease,
  changed: {
    communityPlugins: changedCommunityPlugins,
    bratData: changedBratData,
  },
  before,
  after,
  blocks,
  nextActions: nextActions({ repo, tag, state: after, githubRepo, githubRelease, blocks }),
};

if (writeReportPath) {
  await mkdir(path.dirname(writeReportPath), { recursive: true });
  await writeFile(writeReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
process.exit(blocks.length === 0 ? 0 : 2);

function inspectState({ bratManifest, bratData, communityPlugins }) {
  const frozenEntry = bratData.pluginSubListFrozenVersion.find((entry) => entry?.repo === repo) ?? null;
  const bratVersion = typeof bratManifest.version === "string" ? bratManifest.version : null;
  return {
    bratInstalled: bratManifest.id === bratPluginId,
    bratVersion,
    bratCompatible: compareVersions(bratVersion, "1.1.0") >= 0,
    bratEnabled: communityPlugins.includes(bratPluginId),
    repoConfigured: bratData.pluginList.includes(repo),
    repoFrozenVersion: frozenEntry?.version ?? null,
    hasPersonalAccessToken: typeof bratData.personalAccessToken === "string" && bratData.personalAccessToken.length > 0,
    enableAfterInstall: bratData.enableAfterInstall === true,
    updateAtStartup: bratData.updateAtStartup === true,
    loggingEnabled: bratData.loggingEnabled === true,
    loggingPath: typeof bratData.loggingPath === "string" ? bratData.loggingPath : null,
  };
}

function nextActions({ repo, tag, state, githubRepo, githubRelease, blocks }) {
  if (blocks.length === 0) {
    return [
      "Open the copied vault in Obsidian.",
      "Open BRAT settings and run the update/install flow for the configured Vault MCP repository.",
      "Enable Vault MCP, run Check connection, then Preview index before syncing.",
      "Capture screenshots of BRAT config, Vault MCP enabled state, readiness checklist, preview queue, and sync summary.",
    ];
  }

  const actions = [];
  if (!state.bratEnabled) {
    actions.push("Run this script with --enable-brat to enable BRAT in the copied vault.");
  }
  if (!state.repoConfigured) {
    actions.push(`Run this script with --add-repo to add ${repo} pinned to ${tag} in BRAT's copied-vault config.`);
  }
  if (githubRepo?.visibility === "PRIVATE" && !state.hasPersonalAccessToken) {
    actions.push("Create a fine-grained GitHub token with read-only Contents access to vault-mcp/platform, then paste it into BRAT settings in the copied vault. Do not commit or share the token.");
  }
  if (!githubRelease) {
    actions.push("Run this script with --check-github-release to verify the published BRAT release assets.");
  } else if (!githubRelease.ok) {
    actions.push("Fix the GitHub prerelease assets, then rerun npm run plugin:brat:verify-github.");
  }
  return actions;
}

async function verifyGitHubRelease(repo, tag) {
  try {
    await run("node", [
      path.join(repoRoot, "scripts", "verify-brat-github-release.mjs"),
      "--repo",
      repo,
      "--tag",
      tag,
    ], repoRoot);
    return {
      ok: true,
      repo,
      tag,
      url: `https://github.com/${repo}/releases/tag/${tag}`,
    };
  } catch (error) {
    return {
      ok: false,
      repo,
      tag,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readGitHubRepo(repo) {
  try {
    const output = await runCapture("gh", ["repo", "view", repo, "--json", "nameWithOwner,visibility,url"], repoRoot);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function assertDirectory(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isDirectory(), `Expected ${label}: ${value}`);
}

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile(), `Expected ${label}: ${value}`);
}

async function run(command, commandArgs, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function runCapture(command, commandArgs, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--vault" || arg === "--repo" || arg === "--tag" || arg === "--write-report") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (arg === "--enable-brat" || arg === "--add-repo" || arg === "--check-github-release") {
      parsed[arg.slice(2)] = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function compareVersions(value, minimum) {
  if (!value) {
    return -1;
  }
  const left = value.split(".").map((part) => Number.parseInt(part, 10));
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = Number.isFinite(left[index]) ? left[index] : 0;
    const b = Number.isFinite(right[index]) ? right[index] : 0;
    if (a > b) {
      return 1;
    }
    if (a < b) {
      return -1;
    }
  }
  return 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
