#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const packageRoot = path.join(repoRoot, "dist", "obsidian-plugin");
const args = parseArgs(process.argv.slice(2));
const skipBuild = Boolean(args["skip-build"]);
const dryRun = Boolean(args["dry-run"]);

const manifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
for (const key of ["id", "name", "version", "minAppVersion", "description"]) {
  assert(typeof manifest[key] === "string" && manifest[key].length > 0, `manifest.json is missing ${key}`);
}
assert(manifest.id === "vault-mcp", `Expected manifest id vault-mcp, got ${manifest.id}`);

if (!skipBuild && !dryRun) {
  await run("npm", ["run", "build:plugin"], repoRoot);
}

const files = ["manifest.json", "main.js", "styles.css"];
for (const file of files) {
  await assertFile(path.join(pluginRoot, file), file);
}

const stageDir = path.join(packageRoot, manifest.id);
const zipPath = path.join(packageRoot, `${manifest.id}-${manifest.version}.zip`);
const checksumPath = `${zipPath}.sha256`;

if (!dryRun) {
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(pluginRoot, file), path.join(stageDir, file));
  }
  await rm(zipPath, { force: true });
  await run("zip", ["-qr", zipPath, manifest.id], packageRoot);
  const checksum = await sha256File(zipPath);
  await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, "utf8");
}

const outputs = {
  stageDir,
  zipPath,
  checksumPath,
};

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
  files: files.map((file) => path.join(stageDir, file)),
  outputs,
}, null, 2));

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  assert(result?.isFile(), `Expected ${label} to exist: ${value}`);
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
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    parsed[arg.slice(2)] = true;
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
