#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const runRemoteSmoke = args.has("--smoke") || process.env.RUN_REMOTE_SMOKE === "1";
const environment = process.env.VERCEL_ENVIRONMENT ?? "production";
const teamId = process.env.VERCEL_TEAM_ID ?? "team_mhftpUYWIR5oysxTjLnSLCol";
const projectName = process.env.VERCEL_PROJECT_NAME ?? "vault-mcp-connector";
const authMode = process.env.DEPLOY_AUTH_MODE ?? "oauth";

const vercelToken = process.env.VERCEL_TOKEN;
const vercelAuthArgs = vercelToken ? ["--token", vercelToken] : [];
if (!["oauth", "static"].includes(authMode)) {
  console.error("DEPLOY_AUTH_MODE must be either `oauth` or `static`.");
  process.exit(1);
}

const sharedRuntimeEnv = [
  "PUBLIC_BASE_URL",
  "DATABASE_URL",
  "MCP_SYNC_TOKEN",
  "ALLOWED_ORIGINS",
];
const oauthRuntimeEnv = [
  "OAUTH_ISSUER",
  "OAUTH_AUDIENCE",
  "OAUTH_AUTHORIZATION_SERVER",
  "OAUTH_JWKS_URL",
  "OAUTH_SCOPES",
];
const staticRuntimeEnv = [
  "MCP_ACCESS_TOKEN",
];
const optionalRuntimeEnv = authMode === "oauth" ? ["MCP_ACCESS_TOKEN"] : [];
const requiredRuntimeEnv = [
  ...sharedRuntimeEnv,
  ...(authMode === "oauth" ? oauthRuntimeEnv : staticRuntimeEnv),
];

const missing = [
  ...requiredRuntimeEnv.filter((name) => !process.env[name]),
];

if (missing.length > 0) {
  console.error(`Missing required deployment environment variables:\n${missing.map((name) => `- ${name}`).join("\n")}`);
  console.error("\nSet these in the shell, then rerun `npm run deploy:vercel`.");
  process.exit(1);
}

if (checkOnly) {
  console.log(JSON.stringify({
    ok: true,
    mode: "check",
    teamId,
    projectName,
    environment,
    authMode,
    authSource: vercelToken ? "VERCEL_TOKEN" : "vercel-cli-login",
    runtimeEnv: requiredRuntimeEnv,
    optionalRuntimeEnv: optionalRuntimeEnv.filter((name) => Boolean(process.env[name])),
    runRemoteSmoke,
  }, null, 2));
  process.exit(0);
}

await run("npx", [
  "vercel",
  "link",
  "--yes",
  "--team",
  teamId,
  "--project",
  projectName,
  ...vercelAuthArgs,
]);

for (const name of [...requiredRuntimeEnv, ...optionalRuntimeEnv]) {
  const value = process.env[name];
  if (!value) {
    continue;
  }

  await upsertEnv(name, value);
}

await run("npx", [
  "vercel",
  "pull",
  "--yes",
  `--environment=${environment}`,
  ...vercelAuthArgs,
]);

const deploy = await run("npx", [
  "vercel",
  "deploy",
  "--prod",
  "--yes",
  ...vercelAuthArgs,
]);

const deploymentUrl = extractDeploymentUrl(deploy.stdout);
console.log(JSON.stringify({
  ok: true,
  projectName,
  teamId,
  deploymentUrl,
}, null, 2));

if (runRemoteSmoke) {
  if (!process.env.SMOKE_ACCESS_TOKEN && !process.env.MCP_ACCESS_TOKEN) {
    throw new Error("RUN_REMOTE_SMOKE requires SMOKE_ACCESS_TOKEN or MCP_ACCESS_TOKEN.");
  }

  const smokeBaseUrl = process.env.SMOKE_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? deploymentUrl;
  if (!smokeBaseUrl) {
    throw new Error("RUN_REMOTE_SMOKE requires SMOKE_BASE_URL, PUBLIC_BASE_URL, or a detected deployment URL.");
  }

  await run("npm", ["run", "smoke:remote"], {
    env: {
      ...process.env,
      SMOKE_BASE_URL: smokeBaseUrl,
    },
  });
}

async function upsertEnv(name, value) {
  const add = await run("npx", [
    "vercel",
    "env",
    "add",
    name,
    environment,
    ...vercelAuthArgs,
  ], {
    input: `${value}\n`,
    allowFailure: true,
  });

  if (add.code === 0) {
    return;
  }

  if (!/already exists|exists already|found another/i.test(add.output)) {
    throw new Error(`Failed to add ${name}:\n${add.output}`);
  }

  const update = await run("npx", [
    "vercel",
    "env",
    "update",
    name,
    environment,
    "--yes",
    ...vercelAuthArgs,
  ], {
    input: `${value}\n`,
    allowFailure: true,
  });

  if (update.code !== 0) {
    throw new Error(`Failed to update ${name}:\n${update.output}`);
  }
}

async function run(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: new URL("..", import.meta.url).pathname,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  if (options.input) {
    child.stdin.write(options.input);
  }
  child.stdin.end();

  const code = await new Promise((resolve) => child.on("close", resolve));
  const output = `${stdout}${stderr}`;
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed:\n${output}`);
  }

  return { code, stdout, stderr, output };
}

function extractDeploymentUrl(stdout) {
  const urls = stdout.match(/https:\/\/[^\s",]+/g) ?? [];
  return urls.find((url) => url.includes(".vercel.app")) ?? urls[0] ?? null;
}
