#!/usr/bin/env node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const args = parseArgs(process.argv.slice(2));
const repo = args.repo ?? "vault-mcp/platform";
const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
const tag = args.tag ?? sourceManifest.version;
const keep = Boolean(args.keep);
const runtimeFiles = ["manifest.json", "main.js", "styles.css"];
const release = JSON.parse(await runCapture("gh", [
  "release",
  "view",
  tag,
  "--repo",
  repo,
  "--json",
  "tagName,name,isDraft,isPrerelease,targetCommitish,assets,url",
], repoRoot));

assert(release.tagName === tag, `Expected release tag ${tag}, got ${release.tagName}`);
assert(release.name === tag, `Expected release name ${tag}, got ${release.name}`);
assert(release.isDraft === false, "BRAT cannot install from a draft GitHub release");
assert(release.isPrerelease === true, "Expected the private-alpha BRAT release to be marked prerelease");

const assetsByName = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
for (const file of runtimeFiles) {
  const asset = assetsByName.get(file);
  assert(asset, `GitHub release is missing required BRAT asset: ${file}`);
  assert(asset.state === "uploaded", `GitHub release asset is not uploaded: ${file}`);
  assert(Number(asset.size) > 0, `GitHub release asset is empty: ${file}`);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "vault-mcp-brat-release-"));
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

  const downloaded = {};
  for (const file of runtimeFiles) {
    const filePath = path.join(tempDir, file);
    await assertNonEmpty(filePath, file);
    const sha256 = await sha256File(filePath);
    const digest = assetsByName.get(file)?.digest;
    if (digest?.startsWith("sha256:")) {
      assert(digest === `sha256:${sha256}`, `GitHub digest mismatch for ${file}`);
    }
    downloaded[file] = {
      size: (await stat(filePath)).size,
      sha256,
      digest: digest ?? null,
    };
  }

  console.log(JSON.stringify({
    ok: true,
    repo,
    tag,
    url: release.url,
    targetCommitish: release.targetCommitish,
    prerelease: release.isPrerelease,
    assets: downloaded,
    keptDownloadDir: keep ? tempDir : null,
  }, null, 2));
} finally {
  if (!keep) {
    await rm(tempDir, { recursive: true, force: true });
  }
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

async function runCapture(command, commandArgs, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
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
    if (arg === "--repo" || arg === "--tag") {
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
