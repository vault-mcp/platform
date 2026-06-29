#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const bratRoot = path.join(repoRoot, "dist", "brat");
const bratAssetDir = path.join(bratRoot, "vault-mcp");
const args = parseArgs(process.argv.slice(2));
const skipBuild = Boolean(args["skip-build"]);
const dryRun = Boolean(args["dry-run"]);
const releaseTag = args["release-tag"];
const releaseName = args["release-name"] ?? releaseTag;

const manifestPath = path.join(pluginRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const runtimeFiles = ["manifest.json", "main.js", "styles.css"];

for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
  assert(typeof manifest[key] === "string" && manifest[key].length > 0, `manifest.json is missing ${key}`);
}
assert(manifest.id === "vault-mcp", `Expected manifest id vault-mcp, got ${manifest.id}`);
assert(isObsidianCompatibleVersion(manifest.version), `manifest version is not Obsidian-compatible: ${manifest.version}`);
if (releaseTag) {
  assert(releaseTag === manifest.version, `BRAT release tag must match manifest.version exactly: ${releaseTag} !== ${manifest.version}`);
}
if (releaseName) {
  assert(releaseName === manifest.version, `BRAT release name must match manifest.version exactly: ${releaseName} !== ${manifest.version}`);
}

if (!skipBuild && !dryRun) {
  await run("npm", ["run", "build:plugin"], repoRoot);
}

for (const file of runtimeFiles) {
  await assertFile(path.join(pluginRoot, file), file);
}

if (!dryRun) {
  await rm(bratAssetDir, { recursive: true, force: true });
  await mkdir(bratAssetDir, { recursive: true });
  for (const file of runtimeFiles) {
    await copyFile(path.join(pluginRoot, file), path.join(bratAssetDir, file));
  }
  await writeFile(path.join(bratRoot, `${manifest.id}-${manifest.version}-brat-release.json`), `${JSON.stringify({
    plugin: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      minAppVersion: manifest.minAppVersion,
      description: manifest.description,
    },
    githubRelease: {
      tag: manifest.version,
      name: manifest.version,
      prerelease: true,
      requiredAssets: runtimeFiles,
    },
    brat: {
      minimumRecommendedVersion: "1.1.0",
      installSource: "GitHub release assets",
      privateRepoRequiresGitHubToken: true,
    },
  }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  ok: true,
  dryRun,
  skipBuild,
  plugin: {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    minAppVersion: manifest.minAppVersion,
  },
  bratAssetDir,
  release: {
    tag: manifest.version,
    name: manifest.version,
    assets: runtimeFiles.map((file) => path.join(bratAssetDir, file)),
  },
}, null, 2));

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile(), `Expected ${label} to exist: ${value}`);
  assert(result.size > 0, `Expected ${label} to be non-empty: ${value}`);
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
    if (arg === "--release-tag" || arg === "--release-name") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (arg === "--skip-build" || arg === "--dry-run") {
      parsed[arg.slice(2)] = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function isObsidianCompatibleVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
