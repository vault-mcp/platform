#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const args = parseArgs(process.argv.slice(2));
const bratAssetDir = path.resolve(args.dir ?? path.join(repoRoot, "dist", "brat", "vault-mcp"));
const releaseTag = args["release-tag"];
const releaseName = args["release-name"] ?? releaseTag;
const runtimeFiles = ["manifest.json", "main.js", "styles.css"];

const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
const bratManifest = JSON.parse(await readFile(path.join(bratAssetDir, "manifest.json"), "utf8"));

for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
  assert(bratManifest[key] === sourceManifest[key], `BRAT manifest ${key} does not match source manifest`);
}
assert(sourceManifest.id === "vault-mcp", `Expected source manifest id vault-mcp, got ${sourceManifest.id}`);
assert(isObsidianCompatibleVersion(bratManifest.version), `BRAT manifest version is not Obsidian-compatible: ${bratManifest.version}`);
if (releaseTag) {
  assert(releaseTag === bratManifest.version, `BRAT release tag must match manifest.version exactly: ${releaseTag} !== ${bratManifest.version}`);
}
if (releaseName) {
  assert(releaseName === bratManifest.version, `BRAT release name must match manifest.version exactly: ${releaseName} !== ${bratManifest.version}`);
}

for (const file of runtimeFiles) {
  await assertNonEmpty(path.join(bratAssetDir, file), file);
}
await assertNonEmpty(path.join(pluginRoot, "main.js"), "source main.js");
await assertNonEmpty(path.join(pluginRoot, "styles.css"), "source styles.css");

const bratMain = await readFile(path.join(bratAssetDir, "main.js"), "utf8");
const sourceMain = await readFile(path.join(pluginRoot, "main.js"), "utf8");
const bratStyles = await readFile(path.join(bratAssetDir, "styles.css"), "utf8");
const sourceStyles = await readFile(path.join(pluginRoot, "styles.css"), "utf8");
assert(bratMain === sourceMain, "BRAT main.js does not match built source main.js");
assert(bratStyles === sourceStyles, "BRAT styles.css does not match source styles.css");

console.log(JSON.stringify({
  ok: true,
  bratAssetDir,
  plugin: {
    id: bratManifest.id,
    name: bratManifest.name,
    version: bratManifest.version,
    minAppVersion: bratManifest.minAppVersion,
  },
  release: {
    tag: releaseTag ?? bratManifest.version,
    name: releaseName ?? bratManifest.version,
    requiredAssets: runtimeFiles,
  },
}, null, 2));

async function assertNonEmpty(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile() && result.size > 0, `Expected non-empty ${label}: ${value}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir" || arg === "--release-tag" || arg === "--release-name") {
      parsed[arg.slice(2)] = argv[index + 1];
      index += 1;
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
