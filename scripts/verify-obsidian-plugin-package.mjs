#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const packageRoot = path.join(repoRoot, "dist", "obsidian-plugin");
const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const pluginId = sourceManifest.id;
const zipPath = path.resolve(args.zip ?? path.join(packageRoot, `${pluginId}-${sourceManifest.version}.zip`));
const checksumPath = path.resolve(args.checksum ?? `${zipPath}.sha256`);
const releaseNotesPath = path.resolve(args["release-notes"] ?? path.join(packageRoot, `${pluginId}-${sourceManifest.version}-release-notes.md`));
const releaseManifestPath = path.resolve(args["release-manifest"] ?? path.join(packageRoot, `${pluginId}-${sourceManifest.version}-release.json`));
const keep = Boolean(args.keep);
let vaultRoot = args.vault ? path.resolve(args.vault) : null;
let createdTempVault = false;

assert(pluginId === "vault-mcp", `Expected source manifest id vault-mcp, got ${pluginId}`);
await assertFile(zipPath, "plugin zip");
await assertFile(checksumPath, "plugin checksum");
await assertFile(releaseNotesPath, "plugin release notes");
await assertFile(releaseManifestPath, "plugin release manifest");

const expectedChecksum = await readChecksum(checksumPath, path.basename(zipPath));
const actualChecksum = await sha256File(zipPath);
assert(actualChecksum === expectedChecksum, `Checksum mismatch for ${zipPath}`);
const releaseManifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
const releaseNotes = await readFile(releaseNotesPath, "utf8");
validateReleaseManifest(releaseManifest, sourceManifest, {
  zipName: path.basename(zipPath),
  checksumName: path.basename(checksumPath),
  releaseNotesName: path.basename(releaseNotesPath),
  checksum: actualChecksum,
});
assert(releaseNotes.includes(sourceManifest.version), `Release notes must mention version ${sourceManifest.version}`);
assert(releaseNotes.includes("Private-alpha"), "Release notes must state private-alpha status");

if (!vaultRoot) {
  vaultRoot = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-plugin-install-"));
  createdTempVault = true;
}

const pluginsDir = path.join(vaultRoot, ".obsidian", "plugins");
const installedPluginDir = path.join(pluginsDir, pluginId);

try {
  await mkdir(pluginsDir, { recursive: true });
  await run("unzip", ["-q", "-o", zipPath, "-d", pluginsDir], repoRoot);

  const runtimeFiles = ["manifest.json", "main.js", "styles.css"];
  for (const file of runtimeFiles) {
    await assertFile(path.join(installedPluginDir, file), file);
  }

  const installedManifest = JSON.parse(await readFile(path.join(installedPluginDir, "manifest.json"), "utf8"));
  for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
    assert(installedManifest[key] === sourceManifest[key], `Installed manifest ${key} does not match source manifest`);
  }

  await assertNonEmpty(path.join(installedPluginDir, "main.js"), "main.js");
  await assertNonEmpty(path.join(installedPluginDir, "styles.css"), "styles.css");
  await assertMissing(path.join(installedPluginDir, pluginId, "manifest.json"), "double-nested manifest");

  console.log(JSON.stringify({
    ok: true,
    zipPath,
    checksumPath,
    releaseNotesPath,
    releaseManifestPath,
    checksum: actualChecksum,
    vaultRoot,
    installedPluginDir,
    createdTempVault,
    kept: keep,
    plugin: {
      id: installedManifest.id,
      name: installedManifest.name,
      version: installedManifest.version,
      minAppVersion: installedManifest.minAppVersion,
    },
    files: runtimeFiles.map((file) => path.join(installedPluginDir, file)),
  }, null, 2));
} finally {
  if (createdTempVault && !keep) {
    await rm(vaultRoot, { recursive: true, force: true });
  }
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
    if (arg === "--zip" || arg === "--checksum" || arg === "--release-notes" || arg === "--release-manifest" || arg === "--vault") {
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

function validateReleaseManifest(value, sourceManifest, expected) {
  assert(value && typeof value === "object", "Release manifest must be a JSON object");
  assert(value.plugin?.id === sourceManifest.id, "Release manifest plugin id does not match source manifest");
  assert(value.plugin?.version === sourceManifest.version, "Release manifest plugin version does not match source manifest");
  assert(value.plugin?.minAppVersion === sourceManifest.minAppVersion, "Release manifest minAppVersion does not match source manifest");
  assert(value.package?.zip === expected.zipName, "Release manifest zip filename does not match package");
  assert(value.package?.checksum === expected.checksumName, "Release manifest checksum filename does not match package");
  assert(value.package?.releaseNotes === expected.releaseNotesName, "Release manifest release notes filename does not match package");
  assert(value.package?.sha256 === expected.checksum, "Release manifest SHA256 does not match package checksum");
  assert(JSON.stringify(value.package?.runtimeFiles) === JSON.stringify(["manifest.json", "main.js", "styles.css"]), "Release manifest runtime files are not the Obsidian runtime file set");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
