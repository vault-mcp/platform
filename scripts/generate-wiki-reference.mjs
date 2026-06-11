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

const curatedDeepDiveFiles = [
  "apps/server/src/mcp.ts",
  "apps/server/src/oauth.ts",
  "apps/server/src/store.ts",
  "packages/vault-core/src/search.ts",
  "packages/vault-core/src/indexer.ts",
];

const curatedRanges = {
  "apps/server/src/mcp.ts": [
    [7, 12, "This line is part of the instruction text sent to MCP clients. It tells the client the server is read-only, the vault text is untrusted context, and guessed paths should not work."],
    [14, 23, "This line belongs to the note-summary output schema, the small shape used by list-style tools when they return note cards instead of full note text."],
    [25, 44, "This line belongs to the search-result schema. It defines the fields every search result may return: id, type, path, snippets, metadata, score, and why the result matched."],
    [46, 53, "This line belongs to the fetch output schema. Fetch tools return full indexed text plus citation URL, Obsidian URI, and metadata."],
    [55, 64, "This line creates the MCP server object, names it, gives it the shared instructions, and declares that logging is available."],
    [66, 85, "This line is part of the compatibility search tool. It accepts a query plus optional filters, defaults to section results, calls store.searchVault, and wraps the response for MCP."],
    [87, 105, "This line is part of the note-level search tool. It groups matches by note path so the user sees one result per note instead of one result per heading chunk."],
    [107, 125, "This line is part of the section-level search tool. It searches heading chunks, which is better when the user needs the exact section where a phrase appears."],
    [127, 146, "This line is part of the list_notes tool. It lets clients browse indexed notes by scope, tag, status, type, limit, and cursor without requiring a keyword search."],
    [148, 162, "This line is part of the recent_notes tool. It returns recently updated indexed notes, optionally narrowed to a path scope."],
    [164, 179, "This line is part of the active_projects tool. It exposes active project notes from the allowlisted index and supports pagination."],
    [181, 197, "This line is part of the fetch-by-id tool. It only returns documents already present in the index; unknown or denied ids return the standard unavailable response."],
    [199, 215, "This line is part of the fetch-by-path tool. It accepts an exact vault-relative path, but still only succeeds when that path is already indexed and allowlisted."],
    [217, 234, "This line is part of the index-status tool. It gives safe counts, freshness, and policy scopes without exposing note contents."],
    [236, 256, "This line is part of the debug_search tool. It explains query normalization and likely reasons for few or zero results, without bypassing the allowlist."],
    [261, 280, "This line handles one stateless MCP HTTP request. It creates a fresh MCP server and streamable transport, connects them, handles the request body, then closes resources on completion or error."],
    [282, 289, "This line defines shared annotations for every tool: read-only, non-destructive, idempotent, and not open-world. Clients can use these hints when deciding how safely to call tools."],
    [291, 301, "This line converts structured tool data into MCP's dual format: machine-readable structuredContent plus text JSON for clients that display text."],
    [303, 319, "This line defines the safe not-found response used when a requested id or path is not indexed or not available under the source policy."],
  ],
  "packages/vault-core/src/search.ts": [
    [15, 37, "This line is part of the search constants: default limits, the public index version, safe policy scope labels, and small synonym expansions used during search."],
    [39, 41, "This compatibility function keeps older callers working by sending basic search requests to section search."],
    [43, 58, "This line is part of note-level search: normalize the query, expand synonyms, group chunks into notes, score each note, filter, sort, limit, and format results."],
    [60, 76, "This line is part of section-level search: normalize the query, filter candidate chunks, score each chunk, sort best matches first, limit, and format section results."],
    [78, 82, "This function chooses note search or section search based on the caller's requested mode. Missing mode defaults to section search."],
    [84, 87, "This fetches one indexed chunk by id. If no indexed document has that id, it returns null instead of reading the filesystem."],
    [89, 106, "This fetches a whole indexed note by exact path by collecting all indexed chunks with that path, sorting them, and joining their text back together."],
    [108, 122, "This line is part of list_notes: group chunks into notes, apply metadata/path filters, sort by path, page with a cursor, and return summaries."],
    [124, 132, "This line is part of recent_notes: group by note, optionally filter by scope, sort newest first, limit, and return summaries."],
    [134, 146, "This line is part of active_projects: group by note, keep active project notes, sort newest first, and paginate."],
    [148, 158, "This line builds the safe index-status response: note count, section count, freshness, allowed/excluded scope labels, index version, and no embedding model."],
    [160, 181, "This line builds the debug-search response. It normalizes and expands the query, runs a small search, and returns likely explanations without exposing denied content."],
    [183, 193, "These local types define internal search shapes: one grouped note and one expanded query with exact terms, synonym terms, and original phrase."],
    [195, 220, "This line groups indexed chunks by vault path, sorts each note's chunks into order, and creates one summary object per note."],
    [222, 283, "This line scores a note-level result. It rewards title, path, tag, expanded-term, best-chunk, and recency matches, then keeps the best chunk for snippets."],
    [285, 347, "This line scores an individual section chunk. It checks title, note title, path, tags, heading, exact text terms, expanded terms, and recency."],
    [349, 363, "This line formats a note-level search result for clients, using the best matching chunk for the snippet while returning note-level metadata."],
    [365, 382, "This line formats a section-level search result for clients, preserving section heading, note title, score, match reasons, snippets, and metadata."],
    [384, 391, "This line expands a normalized query into exact terms plus configured synonym terms, then stores both the phrase and combined term list."],
    [393, 408, "This line applies note filters: path scope, tag, tags array, status, and type. A note must pass every requested filter."],
    [410, 421, "This line converts a chunk into a temporary note summary and reuses the note filter logic for section search."],
    [423, 426, "This line decides whether a note counts as an active project based on path/type/project tag and active status."],
    [428, 440, "These helpers normalize tags, extract type and status from metadata or tags, and make filter comparisons consistent."],
    [442, 448, "This helper recovers the note title from a chunk title. Heading chunks are titled like 'Note - Heading', so the heading suffix is removed."],
    [450, 462, "These helpers keep chunk order stable, clamp list/search limits, and parse cursor strings into numeric offsets."],
    [464, 473, "This helper creates a readable snippet around the first matching term instead of returning an arbitrary start of the note."],
    [475, 485, "This helper counts repeated term occurrences in text so repeated matches can add score without unlimited growth."],
    [487, 495, "This helper adds a small freshness boost for recently updated notes while keeping older notes searchable."],
    [497, 511, "These final helpers round scores, normalize strings, expose the Obsidian URI at the top level, and escape heading text used in a regular expression."],
  ],
  "packages/vault-core/src/indexer.ts": [
    [10, 16, "This type defines the inputs for building an index: vault folder, display vault name, public server URL, clock override for tests, and optional report path."],
    [18, 32, "This line initializes an index build: normalize paths, choose defaults, list Markdown files, prepare the output document array, and initialize stats."],
    [34, 40, "This line starts the per-file loop and applies quick path-only deny checks before reading file contents, preventing obvious denied paths from being processed."],
    [42, 49, "This line reads a candidate Markdown file and redacts credential-like content before parsing or indexing it, while recording redaction counts."],
    [51, 55, "This line safely parses the redacted Markdown. Notes with invalid frontmatter are denied and counted instead of crashing the whole index run."],
    [57, 62, "This line applies the full source policy using path, tags, and status. Denied notes are counted and never become indexed documents."],
    [64, 67, "This line gathers file metadata, hashes the redacted content, and splits the parsed note into heading-based chunks."],
    [68, 92, "This line creates one VaultDocument per chunk, including a stable id, title, text, private citation URL, vault path, tags, status, content hash, Obsidian URI, and source-policy evidence."],
    [95, 108, "This line finalizes the index object, optionally writes a Markdown report, and returns the derived index to the caller."],
    [111, 126, "These helpers classify path-only denies, safely parse Markdown, and increment denied-note statistics by rule."],
    [128, 146, "This helper recursively lists Markdown files while skipping hidden folders and node_modules, then sorts paths for deterministic output."],
    [148, 194, "This line writes a human-readable index report with included scopes, excluded scopes, skipped-note counts, and redaction warnings."],
  ],
  "apps/server/src/store.ts": [
    [31, 64, "This line defines storage contracts shared by both implementations: health, search, fetch, list, status, debug search, OAuth client storage, and OAuth replay protection."],
    [66, 73, "This line starts the local JSON store and its in-memory state. It is used for local development and tests."],
    [75, 87, "This line loads a local JSON index file if it exists. Missing files are allowed so a fresh local server can start empty."],
    [89, 95, "This line replaces the local JSON index and writes a pretty JSON snapshot to disk, making sync a full replacement instead of an append."],
    [97, 147, "These methods expose health, search, fetch, listing, status, and debug operations by delegating to pure vault-core functions over the in-memory document array."],
    [149, 172, "These methods store OAuth client registrations and consume authorization-code or refresh-token ids in memory so local OAuth flows can prevent replay."],
    [174, 187, "This helper creates the JSON snapshot written to disk, filling in fallback stats if the sync payload did not include them."],
    [189, 196, "This line starts the Postgres-backed store used in production and creates a connection pool from DATABASE_URL."],
    [198, 249, "This line creates or verifies the production tables and indexes: metadata, vault documents, full-text search vector, OAuth token-use ledger, and OAuth client registrations."],
    [251, 253, "This closes the Postgres connection pool when the server shuts down or tests clean up."],
    [255, 283, "This line performs production sync as one transaction: delete existing documents, insert the new complete set, update metadata, commit, or roll back on failure."],
    [285, 292, "This line reports production health by counting indexed documents and returning the latest generated_at and stats values."],
    [294, 350, "These methods expose production search/fetch/list/status/debug behavior. Most load all indexed documents and reuse vault-core logic so JSON and Postgres behavior stay aligned."],
    [353, 388, "These methods persist and retrieve dynamic OAuth client registrations in Postgres so clients keep stable client ids across serverless invocations."],
    [390, 399, "This method prevents OAuth replay in production by deleting expired token-use rows, inserting the current jti, and returning false if that jti was already used."],
    [401, 418, "This helper loads all indexed documents from Postgres in path and chunk order and restores the top-level Obsidian URI expected by MCP clients."],
  ],
  "apps/server/src/oauth.ts": [
    [7, 24, "These types define the private payloads stored inside signed authorization codes and refresh tokens. They keep client id, scope, resource, subject, and PKCE data together."],
    [26, 29, "These constants set token audiences and lifetimes: authorization codes are separate from refresh tokens, access tokens last one hour, and refresh tokens last 30 days."],
    [31, 43, "This line registers OAuth discovery metadata routes so ChatGPT, Claude, MCP Inspector, and other clients can discover authorization and token endpoints."],
    [44, 85, "This line handles dynamic client registration. It validates redirect URIs and scopes, creates a compact client id, persists it, and returns OAuth registration metadata."],
    [87, 94, "This GET route validates an authorization request and renders the password form that the human owner uses to approve read-only vault access."],
    [96, 125, "This POST route checks the connector password, validates the OAuth request again, signs a short-lived authorization code, and redirects back to the client with code and state."],
    [127, 145, "This token endpoint routes grant requests to either authorization-code exchange or refresh-token rotation, rejecting unsupported grant types."],
    [147, 160, "This function builds authorization-server metadata: issuer, authorize/token/register endpoints, supported grants, PKCE method, scopes, and documentation URL."],
    [162, 164, "This attaches the current IndexStore to the Express request so OAuth route handlers can save clients and token-use records without importing a global store."],
    [166, 204, "This line exchanges an authorization code for tokens. It validates client id, redirect URI, code verifier, resource, signed code contents, and one-time code use."],
    [206, 225, "This line rotates a refresh token. It verifies the signed token, checks the resource, consumes the token id once, and returns a fresh access/refresh pair."],
    [227, 250, "This line creates the token response: a signed one-hour access token plus a new refresh token and the granted scope."],
    [252, 289, "This line validates authorization requests before showing or accepting the password form: response type, client, redirect URI, PKCE, resource, and scope must all match."],
    [291, 315, "These functions sign and verify short-lived authorization codes with a JWT id so each code can be consumed only once."],
    [317, 341, "These functions sign and verify refresh tokens with a JWT id so refresh tokens can rotate and replay attempts can be rejected."],
    [343, 358, "These helpers require self-hosted OAuth config and normalize requested scopes against the supported scope list."],
    [360, 386, "These helpers compare granted/requested scopes, read string parameters from body or query, retrieve the request-attached store, and validate safe redirect URI schemes."],
    [388, 418, "This line renders the simple authorization form, preserving OAuth request parameters as hidden fields and asking only for the connector password."],
    [420, 445, "These low-level helpers compute PKCE challenges, encode the JWT secret, compare passwords safely, and escape HTML in the authorization form."],
    [447, 464, "These error helpers turn expected OAuth failures into JSON errors and unexpected failures into server_error responses."],
  ],
};

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
  const curatedCards = curatedDeepDiveFiles.map((filePath) => {
    const rangeCount = curatedRanges[filePath]?.length ?? 0;
    return `
        <article class="card">
          <h3><code>${escapeHtml(filePath)}</code></h3>
          <p>${escapeHtml(summaryFor(filePath))}</p>
          <p>${rangeCount} curated explanation ranges explain this file's major responsibilities before the generic fallback takes over.</p>
          <a href="${escapeHtml(slugFor(filePath))}.html">Open curated file reference</a>
        </article>`;
  }).join("");

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

      <section id="curated-deep-dives">
        <h2>Curated deep dives</h2>
        <p>These core runtime files now have file-specific explanation ranges for their major blocks, not only generic line heuristics.</p>
        <div class="grid two">${curatedCards}</div>
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
  const curated = curatedExplanation(file.path, lineNumber);
  if (curated) {
    return curated;
  }
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

function curatedExplanation(filePath, lineNumber) {
  const ranges = curatedRanges[filePath] ?? [];
  const match = ranges.find(([start, end]) => lineNumber >= start && lineNumber <= end);
  return match?.[2] ?? null;
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
