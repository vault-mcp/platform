#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = new Date();
const steps = [
  {
    name: "build",
    args: ["run", "build"],
  },
  {
    name: "check:api",
    args: ["run", "check:api"],
  },
  {
    name: "test",
    args: ["test"],
  },
  {
    name: "smoke:mcp-ui",
    args: ["run", "smoke:mcp-ui"],
  },
  {
    name: "audit",
    args: ["audit", "--audit-level=low"],
  },
  {
    name: "plugin:package",
    args: ["run", "plugin:package"],
  },
  {
    name: "plugin:verify-package",
    args: ["run", "plugin:verify-package"],
  },
  {
    name: "plugin:brat:prepare",
    args: ["run", "plugin:brat:prepare", "--", "--skip-build"],
  },
  {
    name: "plugin:brat:verify",
    args: ["run", "plugin:brat:verify"],
  },
  {
    name: "plugin:smoke-fresh-install",
    args: ["run", "plugin:smoke-fresh-install"],
  },
  {
    name: "plugin:smoke-lifecycle",
    args: ["run", "plugin:smoke-lifecycle"],
  },
  {
    name: "smoke:local",
    args: ["run", "smoke:local"],
    env: cleanSmokeEnv(),
  },
  {
    name: "smoke:oauth-local",
    args: ["run", "smoke:oauth-local"],
  },
];

const results = [];

try {
  for (const step of steps) {
    const stepStartedAt = new Date();
    console.log(`\n==> ${step.name}`);
    await runStep(step);
    const durationMs = Date.now() - stepStartedAt.getTime();
    results.push({
      name: step.name,
      ok: true,
      duration_ms: durationMs,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    purpose: "wiki-free local release gate",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    skipped: [
      "wiki generation is paused unless explicitly requested",
      "production OAuth smoke is remote-only",
      "production multi-vault smoke is remote-only",
      "real BRAT install is a manual/external gate",
      "real MCP Inspector, ChatGPT, Claude, and Codex acceptance are manual/external gates",
    ],
    steps: results,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({
    ok: false,
    purpose: "wiki-free local release gate",
    started_at: startedAt.toISOString(),
    failed_at: new Date().toISOString(),
    steps: results,
  }, null, 2));
  process.exit(1);
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, step.args, {
      cwd: new URL("..", import.meta.url).pathname,
      env: step.env ?? process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${step.name} failed with ${status}`));
    });
  });
}

function cleanSmokeEnv() {
  const env = {};
  for (const key of ["HOME", "PATH", "SHELL", "TMPDIR"]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}
