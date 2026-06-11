#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "public", "wiki", "files");

const authoredFiles = [
  "api/index.ts",
  "apps/indexer/package.json",
  "apps/indexer/src/index.ts",
  "apps/indexer/tsconfig.json",
  "apps/server/package.json",
  "apps/server/src/app.test.ts",
  "apps/server/src/app.ts",
  "apps/server/src/auth.ts",
  "apps/server/src/bootstrap.ts",
  "apps/server/src/config.ts",
  "apps/server/src/index.ts",
  "apps/server/src/mcp.ts",
  "apps/server/src/oauth.ts",
  "apps/server/src/store.ts",
  "apps/server/tsconfig.json",
  "docs/PRD.md",
  "docs/acceptance.md",
  "docs/connector-setup.md",
  "docs/deployment.md",
  "docs/threat-model.md",
  "package.json",
  "packages/vault-core/package.json",
  "packages/vault-core/src/hash.ts",
  "packages/vault-core/src/index.ts",
  "packages/vault-core/src/indexer.test.ts",
  "packages/vault-core/src/indexer.ts",
  "packages/vault-core/src/markdown.test.ts",
  "packages/vault-core/src/markdown.ts",
  "packages/vault-core/src/paths.ts",
  "packages/vault-core/src/redaction.ts",
  "packages/vault-core/src/search.ts",
  "packages/vault-core/src/source-policy.test.ts",
  "packages/vault-core/src/source-policy.ts",
  "packages/vault-core/src/types.ts",
  "packages/vault-core/tsconfig.json",
  "public/index.html",
  "public/wiki/index.html",
  "README.md",
  "scripts/generate-wiki-reference.mjs",
  "scripts/smoke-local.mjs",
  "scripts/smoke-oauth-flow.mjs",
  "scripts/smoke-oauth-local.mjs",
  "scripts/smoke-postgres-local.mjs",
  "scripts/smoke-remote.mjs",
  "scripts/vercel-production-deploy.mjs",
  "tsconfig.base.json",
  "tsconfig.json",
  "vercel.json",
  "vitest.config.ts",
  "Dockerfile",
];

const generatedOrBinaryFiles = [
  { path: "package-lock.json", reason: "Generated npm dependency lockfile. It records exact dependency versions and integrity hashes; do not edit it by hand." },
  { path: "public/assets/mcp-vault-server.png", reason: "Binary landing-page image asset. It is referenced by public/index.html and cannot be explained line-by-line as text." },
  { path: "data/.gitkeep", reason: "Empty placeholder so the data directory exists in git." },
  { path: "public/.gitkeep", reason: "Empty placeholder so the public directory existed before the landing page and wiki assets were added." },
  { path: "fixtures/vault/**", reason: "Fixture markdown files used by tests. They are explained through the indexer/search test pages that consume them." },
];

const sectionSummaries = [
  ["Server app", "apps/server/src/app.ts", "Express routes for landing page, wiki, health, OAuth metadata, admin sync, note citation fetches, and MCP transport."],
  ["MCP tools", "apps/server/src/mcp.ts", "Registers the read-only MCP tool surface and converts store responses into MCP tool results."],
  ["Auth", "apps/server/src/auth.ts", "Validates bearer tokens, OAuth JWTs, CORS origins, and protected-resource metadata."],
  ["OAuth", "apps/server/src/oauth.ts", "Self-hosted authorization server: metadata, dynamic client registration, authorize form, token exchange, refresh rotation, and replay protection."],
  ["Storage", "apps/server/src/store.ts", "Shared storage interface plus JSON and Postgres implementations."],
  ["Indexer", "packages/vault-core/src/indexer.ts", "Walks the vault, applies policy, redacts secrets, chunks Markdown, and builds the derived index."],
  ["Search", "packages/vault-core/src/search.ts", "Search, listing, active project discovery, status, diagnostics, and controlled fetch helpers."],
  ["Source policy", "packages/vault-core/src/source-policy.ts", "Allowlist and denylist rules that decide what can enter the index."],
  ["Markdown parsing", "packages/vault-core/src/markdown.ts", "Frontmatter parsing and heading-based chunking."],
  ["Smoke gates", "scripts/smoke-local.mjs", "Local end-to-end gate for sync, auth, tools/list, search, fetch, and denied guesses."],
  ["Remote gate", "scripts/smoke-remote.mjs", "Production/remote gate for OAuth-protected deployed endpoints."],
];

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const fileRecords = [];
for (const relativePath of authoredFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const record = {
    path: relativePath,
    slug: slugFor(relativePath),
    lineCount: lines.length,
    language: languageFor(relativePath),
    summary: summaryFor(relativePath),
    lines,
  };
  fileRecords.push(record);
  await writeFilePage(record);
}

await writeIndexPage(fileRecords);

const totalLines = fileRecords.reduce((sum, file) => sum + file.lineCount, 0);
console.log(JSON.stringify({
  ok: true,
  files: fileRecords.length,
  lines: totalLines,
  output: path.relative(repoRoot, outputRoot),
}, null, 2));

async function writeIndexPage(records) {
  const totalLines = records.reduce((sum, file) => sum + file.lineCount, 0);
  const rows = records.map((file) => `
            <tr>
              <td><a href="${escapeHtml(file.slug)}.html"><code>${escapeHtml(file.path)}</code></a></td>
              <td>${file.lineCount}</td>
              <td>${escapeHtml(file.summary)}</td>
            </tr>`).join("");
  const generatedRows = generatedOrBinaryFiles.map((file) => `
            <tr>
              <td><code>${escapeHtml(file.path)}</code></td>
              <td>${escapeHtml(file.reason)}</td>
            </tr>`).join("");
  const sectionCards = sectionSummaries.map(([title, filePath, summary]) => `
        <article class="card">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(summary)}</p>
          <a href="${escapeHtml(slugFor(filePath))}.html"><code>${escapeHtml(filePath)}</code></a>
        </article>`).join("");

  const html = pageShell({
    title: "Line-by-Line Source Reference",
    body: `
      <section class="hero">
        <p class="eyebrow">Vault MCP Connector Wiki</p>
        <h1>Line-by-line source reference.</h1>
        <p class="lead">This section is generated from the current repository. It covers ${records.length} authored text files and ${totalLines.toLocaleString()} lines with plain-English explanations next to the exact source line.</p>
        <p><a href="/wiki/">Back to the conceptual wiki</a></p>
      </section>

      <section>
        <h2>How to use this reference</h2>
        <div class="grid two">
          <div class="card">
            <h3>Start with the concept page</h3>
            <p>The main wiki explains the system as a story. Use this source reference when you want to inspect a specific file or line.</p>
          </div>
          <div class="card">
            <h3>Read source and explanation together</h3>
            <p>Each row has the line number, the exact code, and a plain-English note explaining why that line exists.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Important paths through the code</h2>
        <div class="grid three">${sectionCards}</div>
      </section>

      <section>
        <h2>Authored file coverage</h2>
        <table>
          <thead><tr><th>File</th><th>Lines</th><th>What it does</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>

      <section>
        <h2>Generated, fixture, or binary files</h2>
        <p>These are still part of the project, but they are not hand-authored application code in the same sense as the files above.</p>
        <table>
          <thead><tr><th>Path</th><th>How to understand it</th></tr></thead>
          <tbody>${generatedRows}</tbody>
        </table>
      </section>
    `,
  });
  await fs.writeFile(path.join(outputRoot, "index.html"), html, "utf8");
}

async function writeFilePage(file) {
  const rows = file.lines.map((line, index) => {
    const lineNumber = index + 1;
    const explanation = explainLine(file, line, lineNumber);
    return `
            <tr>
              <td class="line-number" id="L${lineNumber}"><a href="#L${lineNumber}">${lineNumber}</a></td>
              <td class="source"><pre>${escapeHtml(line || " ")}</pre></td>
              <td>${escapeHtml(explanation)}</td>
            </tr>`;
  }).join("");

  const html = pageShell({
    title: `${file.path} - Line Reference`,
    body: `
      <section class="hero">
        <p class="eyebrow">Line-by-line file reference</p>
        <h1><code>${escapeHtml(file.path)}</code></h1>
        <p class="lead">${escapeHtml(file.summary)}</p>
        <p><a href="index.html">Back to source reference index</a> · <a href="/wiki/">Back to main wiki</a></p>
      </section>

      <section>
        <h2>How to read this file</h2>
        <div class="card">
          <p>${escapeHtml(fileGuidance(file.path))}</p>
        </div>
      </section>

      <section>
        <h2>Every line explained</h2>
        <table class="line-table">
          <thead><tr><th>Line</th><th>Source</th><th>Plain-English explanation</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
  await fs.writeFile(path.join(outputRoot, `${file.slug}.html`), html, "utf8");
}

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Vault MCP Connector Wiki</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172026;
      --muted: #607078;
      --line: #d8e1e5;
      --surface: #f4f7f8;
      --paper: #ffffff;
      --blue: #2367a6;
      --green: #1f765f;
      --code: #102027;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--surface); line-height: 1.58; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    main { width: min(1500px, calc(100% - 36px)); margin: 0 auto; padding: 28px 0 72px; }
    section { padding: 24px 0; border-bottom: 1px solid var(--line); }
    section:last-child { border-bottom: 0; }
    .hero { padding-top: 20px; }
    .eyebrow { margin: 0 0 8px; color: var(--green); font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 0 0 12px; font-size: 44px; line-height: 1.08; letter-spacing: 0; overflow-wrap: anywhere; }
    h2 { margin: 0 0 12px; font-size: 28px; line-height: 1.18; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 18px; }
    p { color: var(--muted); margin: 0 0 12px; }
    .lead { max-width: 900px; font-size: 18px; }
    .grid { display: grid; gap: 14px; }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .card { padding: 16px; border: 1px solid var(--line); background: var(--paper); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eaf0f2; color: var(--ink); }
    tr:last-child td { border-bottom: 0; }
    .line-table { table-layout: fixed; }
    .line-table th:nth-child(1), .line-table td:nth-child(1) { width: 72px; }
    .line-table th:nth-child(2), .line-table td:nth-child(2) { width: 46%; }
    .line-number { color: var(--blue); font-weight: 800; text-align: right; }
    .source pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #edf6f7; background: var(--code); border-radius: 6px; padding: 8px; font-size: 12px; line-height: 1.45; }
    @media (max-width: 900px) {
      main { width: calc(100% - 24px); }
      h1 { font-size: 30px; }
      .grid.two, .grid.three { grid-template-columns: 1fr; }
      .line-table, .line-table thead, .line-table tbody, .line-table tr, .line-table th, .line-table td { display: block; width: 100% !important; }
      .line-table thead { display: none; }
      .line-number { text-align: left; background: #eaf0f2; }
    }
  </style>
</head>
<body>
  <main>${body}
  </main>
</body>
</html>
`;
}

function explainLine(file, line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed) {
    return "Blank line used to visually separate related blocks so the file is easier to scan.";
  }
  if (trimmed.startsWith("#!")) {
    return "Shebang line: lets the operating system run this script with the named interpreter.";
  }
  if (trimmed.startsWith("//")) {
    return "Comment for humans; it explains nearby code and has no runtime effect.";
  }
  if (trimmed.startsWith("import ")) {
    return explainImport(trimmed);
  }
  if (trimmed.startsWith("export type ")) {
    return "Exports a TypeScript type so other files can use this data shape at compile time.";
  }
  if (trimmed.startsWith("export interface ")) {
    return "Exports a TypeScript interface describing the methods or fields another object must provide.";
  }
  if (trimmed.startsWith("export class ")) {
    return "Exports a class, which is a reusable implementation with methods and private state.";
  }
  if (trimmed.startsWith("export function ") || trimmed.startsWith("function ")) {
    return explainFunction(trimmed);
  }
  if (trimmed.startsWith("export async function ") || trimmed.startsWith("async function ")) {
    return explainFunction(trimmed);
  }
  if (trimmed.startsWith("const ") || trimmed.startsWith("let ")) {
    return explainDeclaration(trimmed, file.path);
  }
  if (trimmed.startsWith("return ")) {
    return "Returns this value to the caller and ends the current function path.";
  }
  if (trimmed.startsWith("if ")) {
    return "Starts a conditional branch; the following block only runs when this test is true.";
  }
  if (trimmed.startsWith("} else if ")) {
    return "Continues the previous conditional with another test when earlier tests were false.";
  }
  if (trimmed.startsWith("} else")) {
    return "Fallback branch for the previous condition when no earlier branch matched.";
  }
  if (trimmed.startsWith("for ")) {
    return "Starts a loop that repeats the following block for each item or while the loop condition holds.";
  }
  if (trimmed.startsWith("try")) {
    return "Starts a protected block where failures can be caught and handled instead of crashing immediately.";
  }
  if (trimmed.startsWith("catch")) {
    return "Handles an error thrown from the preceding try block.";
  }
  if (trimmed.startsWith("finally")) {
    return "Runs cleanup code after the try/catch path, whether it succeeded or failed.";
  }
  if (trimmed.startsWith("await ")) {
    return "Waits for an asynchronous operation to finish before continuing.";
  }
  if (trimmed.startsWith("res.")) {
    return "Builds or sends an HTTP response back to the client.";
  }
  if (trimmed.startsWith("app.")) {
    return "Registers Express application behavior such as middleware or an HTTP route.";
  }
  if (trimmed.startsWith("server.registerTool")) {
    return "Registers an MCP tool that clients can call after authentication.";
  }
  if (trimmed.startsWith("describe(")) {
    return "Starts a Vitest test group that organizes related tests.";
  }
  if (trimmed.startsWith("it(")) {
    return "Defines one Vitest test case and describes the behavior it verifies.";
  }
  if (trimmed.startsWith("expect(")) {
    return "Asserts expected behavior in a test; the test fails if this expectation is not true.";
  }
  if (trimmed.startsWith("assert(")) {
    return "Checks a condition in a smoke script and throws an error if the condition is false.";
  }
  if (trimmed.startsWith("await fs.")) {
    return "Performs an asynchronous filesystem operation.";
  }
  if (trimmed.startsWith("await client.query") || trimmed.startsWith("await this.pool.query")) {
    return "Runs a SQL query against Postgres.";
  }
  if (trimmed.startsWith("type ")) {
    return "Defines a TypeScript-only data shape used while compiling the project.";
  }
  if (trimmed === "};" || trimmed === "}" || trimmed === "});" || trimmed === "};," || trimmed === "],") {
    return "Closes the current block, object, array, callback, or statement.";
  }
  if (file.language === "json") {
    return explainJsonLine(trimmed);
  }
  if (file.language === "markdown") {
    return explainMarkdownLine(trimmed);
  }
  if (file.language === "html") {
    return explainHtmlLine(trimmed);
  }
  if (file.path === "Dockerfile") {
    return explainDockerLine(trimmed);
  }
  return genericExplanation(trimmed, lineNumber);
}

function explainImport(line) {
  if (line.startsWith("import type ")) {
    return "Imports TypeScript types only; this helps the compiler and is erased from runtime JavaScript.";
  }
  if (line.includes(" type ")) {
    return "Imports runtime code plus TypeScript-only types from another module.";
  }
  return "Imports code from another module so this file can reuse it.";
}

function explainFunction(line) {
  const name = line.match(/function\s+([A-Za-z0-9_]+)/)?.[1] ?? "an unnamed function";
  return `Defines ${name}, a reusable block of behavior called by other code.`;
}

function explainDeclaration(line, filePath) {
  const name = line.match(/(?:const|let)\s+([A-Za-z0-9_]+)/)?.[1];
  if (!name) {
    return "Declares a local value used by the surrounding code.";
  }
  if (name.toLowerCase().includes("token")) {
    return `Declares ${name}, a token-related value used for authentication or authorization.`;
  }
  if (name.toLowerCase().includes("schema")) {
    return `Declares ${name}, a validation schema that describes allowed input or output data.`;
  }
  if (name.toLowerCase().includes("config")) {
    return `Declares ${name}, configuration data that controls runtime behavior.`;
  }
  if (filePath.includes("test")) {
    return `Declares ${name}, test setup or expected data used by the current test.`;
  }
  return `Declares ${name}, a local value used later in this file.`;
}

function explainJsonLine(line) {
  if (line === "{" || line === "}" || line === "}," || line === "},") {
    return "JSON punctuation that opens or closes an object.";
  }
  if (line === "[" || line === "]" || line === "],") {
    return "JSON punctuation that opens or closes an array.";
  }
  const key = line.match(/^"([^"]+)":/)?.[1];
  if (key) {
    return `JSON setting named "${key}"; its value configures package, TypeScript, Vercel, or test behavior.`;
  }
  return "JSON value or punctuation that belongs to the surrounding configuration object.";
}

function explainMarkdownLine(line) {
  if (line.startsWith("#")) {
    return "Markdown heading; it gives structure to the document.";
  }
  if (line.startsWith("- ")) {
    return "Markdown bullet item; it records one list entry.";
  }
  if (/^\d+\./.test(line)) {
    return "Markdown numbered step; it records ordered instructions.";
  }
  if (line.startsWith("```")) {
    return "Markdown code-fence marker that starts or ends a code block.";
  }
  return "Markdown prose or table content intended for human documentation.";
}

function explainHtmlLine(line) {
  if (line.startsWith("<!doctype")) {
    return "Declares the document as modern HTML.";
  }
  if (line.startsWith("<style") || line.startsWith("</style")) {
    return "Starts or ends the CSS block that styles this page.";
  }
  if (line.startsWith("<script") || line.startsWith("</script")) {
    return "Starts or ends browser JavaScript for this page.";
  }
  if (line.startsWith("<")) {
    return "HTML markup that creates page structure or content.";
  }
  if (line.includes("{") || line.includes(":")) {
    return "CSS rule or property that controls the page layout, color, spacing, or typography.";
  }
  return "Text content or formatting inside the HTML page.";
}

function explainDockerLine(line) {
  if (line.startsWith("FROM ")) {
    return "Chooses the base container image.";
  }
  if (line.startsWith("WORKDIR ")) {
    return "Sets the working directory inside the container.";
  }
  if (line.startsWith("COPY ")) {
    return "Copies files from the repository into the container image.";
  }
  if (line.startsWith("RUN ")) {
    return "Runs a build-time command while creating the container image.";
  }
  if (line.startsWith("CMD ")) {
    return "Defines the command that runs when the container starts.";
  }
  return "Dockerfile instruction or continuation line used to build the container image.";
}

function genericExplanation(line, lineNumber) {
  if (line.endsWith("{")) {
    return "Opens a block; the following indented lines belong to this statement.";
  }
  if (line.endsWith(",")) {
    return "Provides one item in an object, array, argument list, or configuration list.";
  }
  if (line.includes("=>")) {
    return "Uses an arrow function, a compact JavaScript function often used as a callback.";
  }
  if (line.includes("=")) {
    return "Assigns or compares values as part of the surrounding logic.";
  }
  return `Line ${lineNumber} participates in the surrounding ${line.includes("(") ? "function call or expression" : "block"}; read it with the neighboring lines for full context.`;
}

function fileGuidance(filePath) {
  if (filePath.includes("app.ts")) {
    return "Read this file as the HTTP routing table: public pages first, then health/OAuth metadata, admin sync, protected note fetches, and MCP request handling.";
  }
  if (filePath.includes("mcp.ts")) {
    return "Read this file as the MCP contract: each registerTool block defines one client-visible tool, its input schema, its output schema, and the store method it calls.";
  }
  if (filePath.includes("oauth.ts")) {
    return "Read this file as a small OAuth authorization server: metadata, registration, authorize, token, refresh, signing, and form rendering are grouped together.";
  }
  if (filePath.includes("store.ts")) {
    return "Read this file as two implementations of the same storage interface: JSON for local development and Postgres for production.";
  }
  if (filePath.includes("indexer.ts")) {
    return "Read this file as the path from vault files to index documents: list files, deny unsafe paths, parse Markdown, redact secrets, chunk content, and emit metadata.";
  }
  if (filePath.includes("search.ts")) {
    return "Read this file as the read-only query engine over already-indexed documents. It never reads the vault directly.";
  }
  if (filePath.includes("test")) {
    return "Read this file as executable documentation: each test proves a behavior the connector is expected to keep.";
  }
  if (filePath.includes("smoke")) {
    return "Read this file as an end-to-end gate. It starts or contacts a server and proves the critical runtime behavior still works.";
  }
  return "Read this file from top to bottom. Imports and constants usually set up dependencies first; functions or configuration blocks then define the actual behavior.";
}

function summaryFor(filePath) {
  const summaries = new Map([
    ["api/index.ts", "Vercel Function entrypoint that creates the configured Express app."],
    ["apps/server/src/app.ts", "Express application and HTTP routes for the deployed service."],
    ["apps/server/src/auth.ts", "Bearer token, OAuth JWT, CORS, and protected-resource helpers."],
    ["apps/server/src/bootstrap.ts", "Loads config, chooses JSON or Postgres storage, and creates the app."],
    ["apps/server/src/config.ts", "Environment variable parsing and runtime configuration."],
    ["apps/server/src/index.ts", "Node server startup and shutdown handling."],
    ["apps/server/src/mcp.ts", "MCP server, tool definitions, schemas, and Streamable HTTP transport."],
    ["apps/server/src/oauth.ts", "Self-hosted OAuth registration, authorization, token, refresh, and replay protection routes."],
    ["apps/server/src/store.ts", "Storage interface plus JSON and Postgres index stores."],
    ["apps/indexer/src/index.ts", "CLI for building and optionally syncing the vault index."],
    ["packages/vault-core/src/indexer.ts", "Vault scanner, source policy application, redaction, chunking, metadata, and report output."],
    ["packages/vault-core/src/search.ts", "Read-only search, list, recent, active project, fetch, status, and diagnostics helpers."],
    ["packages/vault-core/src/source-policy.ts", "V1 allowlist and denylist rules."],
    ["packages/vault-core/src/markdown.ts", "Markdown frontmatter parsing and heading chunking."],
    ["packages/vault-core/src/redaction.ts", "Credential-like string redaction before indexing."],
    ["packages/vault-core/src/types.ts", "Shared TypeScript types for index documents, search results, and stats."],
    ["public/index.html", "Public landing page for the connector."],
    ["public/wiki/index.html", "Conceptual wiki landing page."],
  ]);
  if (summaries.has(filePath)) {
    return summaries.get(filePath);
  }
  if (filePath.endsWith(".test.ts")) {
    return "Automated tests that document and verify expected behavior.";
  }
  if (filePath.endsWith(".mjs")) {
    return "Node script used for smoke testing, deployment, or wiki generation.";
  }
  if (filePath.endsWith(".md")) {
    return "Human documentation for setup, deployment, acceptance, or project requirements.";
  }
  if (filePath.endsWith("package.json")) {
    return "Package metadata, dependencies, and npm scripts.";
  }
  if (filePath.endsWith("tsconfig.json") || filePath === "tsconfig.base.json") {
    return "TypeScript compiler configuration.";
  }
  if (filePath === "vercel.json") {
    return "Vercel deployment configuration.";
  }
  if (filePath === "Dockerfile") {
    return "Container image build instructions.";
  }
  return "Authored project file.";
}

function languageFor(filePath) {
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".html")) return "html";
  if (filePath === "Dockerfile") return "docker";
  return "code";
}

function slugFor(filePath) {
  return filePath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
