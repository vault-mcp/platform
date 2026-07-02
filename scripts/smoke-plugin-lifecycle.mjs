#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(repoRoot, "dist", "obsidian-plugin");
const args = parseArgs(process.argv.slice(2));
const keep = Boolean(args.keep);
let vaultRoot = args.vault ? path.resolve(args.vault) : null;
let createdTempVault = false;

const releaseManifestPath = path.resolve(args["release-manifest"] ?? await findReleaseManifest(packageRoot));
const releaseManifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
validateReleaseManifestShape(releaseManifest, releaseManifestPath);

const pluginId = releaseManifest.plugin.id;
const zipPath = path.resolve(args.zip ?? path.join(path.dirname(releaseManifestPath), releaseManifest.package.zip));
const checksumPath = path.resolve(args.checksum ?? path.join(path.dirname(releaseManifestPath), releaseManifest.package.checksum));
const releaseNotesPath = path.resolve(args["release-notes"] ?? path.join(path.dirname(releaseManifestPath), releaseManifest.package.releaseNotes));

await assertFile(zipPath, "plugin zip");
await assertFile(checksumPath, "plugin checksum");
await assertFile(releaseNotesPath, "plugin release notes");

const expectedChecksum = await readChecksum(checksumPath, path.basename(zipPath));
const actualChecksum = await sha256File(zipPath);
assert(actualChecksum === expectedChecksum, `Checksum mismatch for ${zipPath}`);
assert(releaseManifest.package.sha256 === actualChecksum, "Release manifest SHA256 does not match package checksum");

if (!vaultRoot) {
  vaultRoot = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-lifecycle-"));
  createdTempVault = true;
}

const obsidianDir = path.join(vaultRoot, ".obsidian");
const pluginsDir = path.join(obsidianDir, "plugins");
const installedPluginDir = path.join(pluginsDir, pluginId);
const dataPath = path.join(installedPluginDir, "data.json");
const notePath = path.join(vaultRoot, "User Note.md");
const auditNotePath = path.join(vaultRoot, "00 System", "Vault MCP Write Audit", "Lifecycle Proof.md");
const extractionRoot = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-lifecycle-unzip-"));

const preservedSettings = {
  serverUrl: "https://vault-mcp-connector.vercel.app",
  vaultId: "lifecycle-proof",
  indexMode: "rules_plus_approvals",
  writeMode: "review_required",
  includePrefixes: ["20 Projects/"],
  sentinel: `preserve-data-json-${Date.now()}`,
};

try {
  await mkdir(installedPluginDir, { recursive: true });
  await mkdir(path.dirname(auditNotePath), { recursive: true });
  await writeFile(notePath, "# User note should survive uninstall\n", "utf8");
  await writeFile(auditNotePath, "# Audit note should survive uninstall\n", "utf8");
  await writeFile(path.join(obsidianDir, "community-plugins.json"), `${JSON.stringify([pluginId], null, 2)}\n`, "utf8");
  await writeFile(path.join(installedPluginDir, "manifest.json"), `${JSON.stringify({
    id: pluginId,
    name: "Vault MCP",
    version: "0.0.0-lifecycle",
    minAppVersion: "1.5.0",
    description: "Old lifecycle smoke plugin manifest",
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(installedPluginDir, "main.js"), "module.exports = {};\n", "utf8");
  await writeFile(path.join(installedPluginDir, "styles.css"), ".vault-mcp-old {}\n", "utf8");
  await writeFile(dataPath, `${JSON.stringify(preservedSettings, null, 2)}\n`, "utf8");

  const dataBeforeUpgrade = await readFile(dataPath, "utf8");
  const oldMain = await readFile(path.join(installedPluginDir, "main.js"), "utf8");
  const oldStyles = await readFile(path.join(installedPluginDir, "styles.css"), "utf8");

  await run("unzip", ["-q", "-o", zipPath, "-d", extractionRoot], repoRoot);
  const extractedPluginDir = path.join(extractionRoot, pluginId);
  await assertDirectory(extractedPluginDir, "extracted plugin folder");

  for (const file of releaseManifest.package.runtimeFiles) {
    await copyFile(path.join(extractedPluginDir, file), path.join(installedPluginDir, file));
  }

  const installedManifest = JSON.parse(await readFile(path.join(installedPluginDir, "manifest.json"), "utf8"));
  for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
    assert(installedManifest[key] === releaseManifest.plugin[key], `Installed manifest ${key} does not match release manifest after upgrade`);
  }

  const dataAfterUpgrade = await readFile(dataPath, "utf8");
  assert(dataAfterUpgrade === dataBeforeUpgrade, "Upgrade did not preserve data.json exactly");
  assert(await readFile(path.join(installedPluginDir, "main.js"), "utf8") !== oldMain, "Upgrade did not replace main.js");
  assert(await readFile(path.join(installedPluginDir, "styles.css"), "utf8") !== oldStyles, "Upgrade did not replace styles.css");
  await assertMissing(path.join(installedPluginDir, pluginId, "manifest.json"), "double-nested manifest");

  await rm(installedPluginDir, { recursive: true, force: true });
  const enabledPlugins = JSON.parse(await readFile(path.join(obsidianDir, "community-plugins.json"), "utf8"));
  const enabledAfterUninstall = enabledPlugins.filter((id) => id !== pluginId);
  await writeFile(path.join(obsidianDir, "community-plugins.json"), `${JSON.stringify(enabledAfterUninstall, null, 2)}\n`, "utf8");

  await assertMissing(installedPluginDir, "plugin folder after uninstall");
  await assertFile(notePath, "user note after uninstall");
  await assertFile(auditNotePath, "audit note after uninstall");
  const finalEnabledPlugins = JSON.parse(await readFile(path.join(obsidianDir, "community-plugins.json"), "utf8"));
  assert(!finalEnabledPlugins.includes(pluginId), "Uninstall did not disable plugin id in community-plugins.json");

  const report = {
    ok: true,
    purpose: "private-alpha plugin upgrade and uninstall smoke",
    plugin: {
      id: installedManifest.id,
      name: installedManifest.name,
      version: installedManifest.version,
      minAppVersion: installedManifest.minAppVersion,
    },
    release: {
      zipPath,
      checksumPath,
      releaseNotesPath,
      releaseManifestPath,
      sha256: actualChecksum,
    },
    disposableVault: {
      vaultRoot,
      installedPluginDir,
      dataPath,
      createdTempVault,
      kept: keep,
    },
    verified: [
      "release manifest, checksum, and zip are self-consistent",
      "upgrade replaces manifest.json, main.js, and styles.css from the release zip",
      "upgrade preserves existing .obsidian/plugins/vault-mcp/data.json exactly",
      "upgrade avoids double-nested plugin folders",
      "uninstall removes the plugin folder",
      "uninstall removes vault-mcp from community-plugins.json",
      "uninstall leaves normal vault notes in place",
      "uninstall leaves write-audit notes in place",
    ],
  };

  if (args.report) {
    const reportPath = path.resolve(args.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    report.reportPath = reportPath;
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
  if (createdTempVault && !keep) {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

async function findReleaseManifest(root) {
  const entries = await readdir(root).catch(() => []);
  const matches = entries.filter((entry) => entry.endsWith("-release.json"));
  assert(matches.length === 1, `Expected exactly one release manifest in ${root}; found ${matches.length}`);
  return path.join(root, matches[0]);
}

async function readChecksum(file, zipName) {
  const text = await readFile(file, "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0);
  assert(line, `Checksum file is empty: ${file}`);
  const [hash, name] = line.trim().split(/\s+/);
  assert(/^[a-f0-9]{64}$/i.test(hash), `Checksum file does not start with a SHA256 hash: ${file}`);
  assert(!name || name === zipName, `Checksum file references ${name}, expected ${zipName}`);
  return hash.toLowerCase();
}

async function sha256File(file) {
  const buffer = await readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
}

async function assertDirectory(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isDirectory(), `Expected ${label} to exist: ${value}`);
}

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile(), `Expected ${label} to exist: ${value}`);
}

async function assertMissing(value, label) {
  const result = await stat(value).catch(() => null);
  assert(!result, `Unexpected ${label}: ${value}`);
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
    if (arg === "--zip" || arg === "--checksum" || arg === "--release-notes" || arg === "--release-manifest" || arg === "--vault" || arg === "--report") {
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

function validateReleaseManifestShape(value, file) {
  assert(value && typeof value === "object", `Release manifest must be an object: ${file}`);
  for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
    assert(typeof value.plugin?.[key] === "string" && value.plugin[key].length > 0, `Release manifest plugin.${key} is missing`);
  }
  for (const key of ["zip", "checksum", "releaseNotes", "sha256"]) {
    assert(typeof value.package?.[key] === "string" && value.package[key].length > 0, `Release manifest package.${key} is missing`);
  }
  assert(Array.isArray(value.package.runtimeFiles), "Release manifest package.runtimeFiles must be an array");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
