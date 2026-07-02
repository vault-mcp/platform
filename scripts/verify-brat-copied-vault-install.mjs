#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(args.vault ?? "/Users/tjt/Documents/Tristan's Personal vault copy");
const repo = args.repo ?? "vault-mcp/platform";
const tag = args.tag ?? sourceManifest.version;
const writeReportPath = args["write-report"] ? path.resolve(args["write-report"]) : null;
const keep = Boolean(args.keep);
const pluginId = sourceManifest.id;
const runtimeFiles = ["manifest.json", "main.js", "styles.css"];
const installedPluginDir = path.join(vaultRoot, ".obsidian", "plugins", pluginId);
const communityPluginsPath = path.join(vaultRoot, ".obsidian", "community-plugins.json");

await assertDirectory(installedPluginDir, "installed Vault MCP plugin directory");
await assertFile(communityPluginsPath, "copied-vault community plugins list");

const communityPlugins = JSON.parse(await readFile(communityPluginsPath, "utf8"));
assert(Array.isArray(communityPlugins), "community-plugins.json must be a JSON array");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-brat-copy-install-"));
try {
  await run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    repo,
    "--dir",
    tempDir,
    "--pattern",
    "manifest.json",
    "--pattern",
    "main.js",
    "--pattern",
    "styles.css",
  ], repoRoot);

  await run("node", [
    path.join(repoRoot, "scripts", "verify-brat-release.mjs"),
    "--dir",
    tempDir,
    "--release-tag",
    tag,
    "--release-name",
    tag,
  ], repoRoot);

  const installedManifest = JSON.parse(await readFile(path.join(installedPluginDir, "manifest.json"), "utf8"));
  for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
    assert(installedManifest[key] === sourceManifest[key], `Installed manifest ${key} does not match source manifest`);
  }
  assert(installedManifest.version === tag, `Installed manifest version ${installedManifest.version} does not match BRAT tag ${tag}`);
  assert(communityPlugins.includes(pluginId), `${pluginId} is not enabled in copied-vault community-plugins.json`);

  const files = {};
  for (const file of runtimeFiles) {
    const installedPath = path.join(installedPluginDir, file);
    const releasePath = path.join(tempDir, file);
    await assertNonEmpty(installedPath, `installed ${file}`);
    await assertNonEmpty(releasePath, `release ${file}`);
    const installedHash = await sha256File(installedPath);
    const releaseHash = await sha256File(releasePath);
    assert(installedHash === releaseHash, `Installed ${file} does not match GitHub BRAT release asset`);
    files[file] = {
      installedPath,
      releasePath: keep ? releasePath : null,
      sha256: installedHash,
      size: (await stat(installedPath)).size,
    };
  }

  const dataPath = path.join(installedPluginDir, "data.json");
  const dataStat = await stat(dataPath).catch(() => null);
  const report = {
    ok: true,
    purpose: "copied-vault Vault MCP install matches GitHub BRAT release assets",
    vaultRoot,
    repo,
    tag,
    installedPluginDir,
    plugin: {
      id: installedManifest.id,
      name: installedManifest.name,
      version: installedManifest.version,
      minAppVersion: installedManifest.minAppVersion,
      enabled: communityPlugins.includes(pluginId),
      dataJsonPresent: Boolean(dataStat?.isFile()),
    },
    files,
    keptDownloadDir: keep ? tempDir : null,
  };

  if (writeReportPath) {
    await mkdir(path.dirname(writeReportPath), { recursive: true });
    await writeFile(writeReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!keep) {
    await rm(tempDir, { recursive: true, force: true });
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

async function assertNonEmpty(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile() && result.size > 0, `Expected non-empty ${label}: ${value}`);
}

async function sha256File(file) {
  const buffer = await readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--vault" || arg === "--repo" || arg === "--tag" || arg === "--write-report") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (arg === "--keep") {
      parsed.keep = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
