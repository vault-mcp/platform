import { copyFile, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repoRoot, "apps", "obsidian-plugin");
const defaultVault = "/Users/tjt/Documents/Tristan's Personal vault copy";

const args = process.argv.slice(2);
const options = {
  vault: process.env.VAULT_ROOT || defaultVault,
  pluginId: "vault-mcp",
  skipBuild: false,
  dryRun: false,
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--vault") {
    options.vault = args[index + 1];
    index += 1;
  } else if (arg === "--plugin-id") {
    options.pluginId = args[index + 1];
    index += 1;
  } else if (arg === "--skip-build") {
    options.skipBuild = true;
  } else if (arg === "--dry-run") {
    options.dryRun = true;
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

if (!options.vault) {
  throw new Error("A vault path is required. Pass --vault or set VAULT_ROOT.");
}

await assertDirectory(options.vault, "vault");

if (!options.skipBuild && !options.dryRun) {
  await run("npm", ["run", "build:plugin"], repoRoot);
}

const targetDir = path.join(options.vault, ".obsidian", "plugins", options.pluginId);
const files = ["manifest.json", "main.js", "styles.css"];
const copied = [];

if (!options.dryRun) {
  await mkdir(targetDir, { recursive: true });
}

for (const file of files) {
  const from = path.join(pluginRoot, file);
  const to = path.join(targetDir, file);
  await assertFile(from, file);
  if (!options.dryRun) {
    await copyFile(from, to);
  }
  copied.push({ from, to });
}

console.log(JSON.stringify({
  ok: true,
  dryRun: options.dryRun,
  vault: options.vault,
  pluginId: options.pluginId,
  targetDir,
  copied,
}, null, 2));

async function assertDirectory(value, label) {
  const result = await stat(value).catch(() => null);
  if (!result?.isDirectory()) {
    throw new Error(`Expected ${label} directory to exist: ${value}`);
  }
}

async function assertFile(value, label) {
  const result = await stat(value).catch(() => null);
  if (!result?.isFile()) {
    throw new Error(`Expected ${label} to exist: ${value}`);
  }
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
