#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(args.vault ?? path.join(repoRoot, "fixtures", "vault"));

const allowedDemoPaths = [
  "20 Projects/Test Project/Project Home.md",
  "40 Reference/Recipes/Crisp Twilight.md",
  "40 Reference/Self Hosting/Home Server Playbook.md",
];

const deniedDemoPaths = [
  "Credentials/API Keys.md",
  "Daily Notes/2026-06-10.md",
];

const expectedSnippets = {
  "20 Projects/Test Project/Project Home.md": "connector discovery improvements",
  "40 Reference/Recipes/Crisp Twilight.md": "fixture-secret-value",
  "40 Reference/Self Hosting/Home Server Playbook.md": "Cloudflare tunnels",
  "Credentials/API Keys.md": "Private credential content should never be indexed.",
  "Daily Notes/2026-06-10.md": "Private daily note content",
};

const markdownFiles = await listMarkdownFiles(vaultRoot);
const relativeFiles = markdownFiles.map((file) => toPosix(path.relative(vaultRoot, file))).sort();
const failures = [];

for (const requiredPath of [...allowedDemoPaths, ...deniedDemoPaths]) {
  if (!relativeFiles.includes(requiredPath)) {
    failures.push(`missing required demo note: ${requiredPath}`);
  }
}

for (const filePath of markdownFiles) {
  const relativePath = toPosix(path.relative(vaultRoot, filePath));
  const text = await readFile(filePath, "utf8");
  const expected = expectedSnippets[relativePath];
  if (expected && !text.includes(expected)) {
    failures.push(`${relativePath} is missing expected demo text`);
  }
  for (const issue of publicContentIssues(relativePath, text)) {
    failures.push(issue);
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    purpose: "demo vault fixture verifier",
    vaultRoot,
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  purpose: "demo vault fixture verifier",
  vaultRoot,
  markdownFiles: relativeFiles,
  expectedIndexedByPolicy: allowedDemoPaths,
  expectedDeniedByPolicy: deniedDemoPaths,
  redactionFixture: "40 Reference/Recipes/Crisp Twilight.md",
  notes: [
    "The demo vault contains synthetic data only.",
    "fixture-secret-value is intentionally present to exercise redaction behavior.",
    "Credentials and Daily Notes paths are intentionally present to exercise deny rules.",
  ],
}, null, 2));

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function publicContentIssues(relativePath, text) {
  const issues = [];
  const forbidden = [
    [/\/Users\/tjt\//, "private local user path"],
    [/personal vault/i, "live vault name"],
    [/github_pat_[A-Za-z0-9_]+/, "GitHub fine-grained token"],
    [/ghp_[A-Za-z0-9_]+/, "GitHub token"],
    [/Bearer\s+(?!values?\b)[A-Za-z0-9._-]+/i, "bearer token value"],
    [/postgres(?:ql)?:\/\/[^"'\s]+/i, "database URL"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) {
      issues.push(`${relativePath} contains ${label}`);
    }
  }

  if (text.includes("fixture-secret-value") && relativePath !== "40 Reference/Recipes/Crisp Twilight.md") {
    issues.push(`${relativePath} contains fixture-secret-value outside the redaction fixture`);
  }

  return issues;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--vault") {
      parsed.vault = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-demo-vault.mjs [options]

Verifies that fixtures/vault is a synthetic demo vault suitable for public docs
and policy/redaction examples.

Options:
  --vault <path>  Demo vault root. Defaults to fixtures/vault.
`);
}
