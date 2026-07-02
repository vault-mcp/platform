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
const pluginVersion = releaseManifest.plugin.version;
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

const releaseNotes = await readFile(releaseNotesPath, "utf8");
assert(releaseNotes.includes(pluginVersion), `Release notes must mention version ${pluginVersion}`);
assert(releaseNotes.includes("Private-alpha"), "Release notes must state private-alpha status");

if (!vaultRoot) {
  vaultRoot = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-fresh-install-"));
  createdTempVault = true;
}

const obsidianDir = path.join(vaultRoot, ".obsidian");
const pluginsDir = path.join(obsidianDir, "plugins");
const installedPluginDir = path.join(pluginsDir, pluginId);
const extractionRoot = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-release-unzip-"));

try {
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(path.join(vaultRoot, "Welcome.md"), "# Disposable Vault MCP install smoke\n", "utf8");

  await run("unzip", ["-q", "-o", zipPath, "-d", extractionRoot], repoRoot);
  const extractedPluginDir = path.join(extractionRoot, pluginId);
  await assertDirectory(extractedPluginDir, "extracted plugin folder");
  await rm(installedPluginDir, { recursive: true, force: true });
  await mkdir(installedPluginDir, { recursive: true });

  for (const file of releaseManifest.package.runtimeFiles) {
    await copyFile(path.join(extractedPluginDir, file), path.join(installedPluginDir, file));
  }

  await writeFile(path.join(obsidianDir, "community-plugins.json"), `${JSON.stringify([pluginId], null, 2)}\n`, "utf8");

  const runtimeFiles = ["manifest.json", "main.js", "styles.css"];
  assert(JSON.stringify(releaseManifest.package.runtimeFiles) === JSON.stringify(runtimeFiles), "Release manifest runtime file set is not the private-alpha runtime set");
  for (const file of runtimeFiles) {
    await assertFile(path.join(installedPluginDir, file), file);
    await assertNonEmpty(path.join(installedPluginDir, file), file);
  }

  const installedManifest = JSON.parse(await readFile(path.join(installedPluginDir, "manifest.json"), "utf8"));
  for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
    assert(installedManifest[key] === releaseManifest.plugin[key], `Installed manifest ${key} does not match release manifest`);
  }

  await assertMissing(path.join(installedPluginDir, pluginId, "manifest.json"), "double-nested manifest");
  const enabledPlugins = JSON.parse(await readFile(path.join(obsidianDir, "community-plugins.json"), "utf8"));
  assert(Array.isArray(enabledPlugins) && enabledPlugins.includes(pluginId), "Disposable vault did not enable the plugin id in community-plugins.json");

  const report = {
    ok: true,
    purpose: "fresh-user private-alpha zip install smoke",
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
      enabledPluginsFile: path.join(obsidianDir, "community-plugins.json"),
      createdTempVault,
      kept: keep,
    },
    verified: [
      "release manifest is self-consistent",
      "zip checksum matches .sha256 and release manifest",
      "release notes mention version and private-alpha status",
      "zip extracts to one plugin folder",
      "runtime files install under .obsidian/plugins/vault-mcp",
      "installed manifest matches release manifest",
      "main.js and styles.css are non-empty",
      "double-nested plugin folder is absent",
      "community-plugins.json enables vault-mcp",
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

async function assertNonEmpty(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile() && result.size > 0, `Expected non-empty ${label}: ${value}`);
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
