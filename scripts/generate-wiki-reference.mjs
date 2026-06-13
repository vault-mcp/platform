#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "public", "wiki", "files");

const authoredFiles = [
  "api/index.ts",
  "apps/cli/package.json",
  "apps/cli/src/index.ts",
  "apps/cli/tsconfig.json",
  "apps/obsidian-plugin/manifest.json",
  "apps/obsidian-plugin/package.json",
  "apps/obsidian-plugin/src/main.ts",
  "apps/obsidian-plugin/styles.css",
  "apps/obsidian-plugin/tsconfig.json",
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
  "docs/v2-migration.md",
  "package.json",
  "packages/core/package.json",
  "packages/core/src/hash.ts",
  "packages/core/src/index.ts",
  "packages/core/src/indexer.test.ts",
  "packages/core/src/indexer.ts",
  "packages/core/src/markdown.test.ts",
  "packages/core/src/markdown.ts",
  "packages/core/src/paths.ts",
  "packages/core/src/redaction.ts",
  "packages/core/src/search.ts",
  "packages/core/src/source-policy.test.ts",
  "packages/core/src/source-policy.ts",
  "packages/core/src/types.ts",
  "packages/core/tsconfig.json",
  "public/index.html",
  "public/wiki/index.html",
  "public/wiki/tutorial.html",
  "README.md",
  "scripts/generate-wiki-reference.mjs",
  "scripts/seed-write-proposals.mjs",
  "scripts/verify-ui-smoke.mjs",
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
  ["Indexer", "packages/core/src/indexer.ts", "Walks the vault, applies policy, redacts secrets, chunks Markdown, and builds the derived index."],
  ["Obsidian plugin", "apps/obsidian-plugin/src/main.ts", "Private-alpha plugin shell for indexing controls, sync, dashboard status, and future write approvals."],
  ["Search", "packages/core/src/search.ts", "Search, listing, active project discovery, status, diagnostics, and controlled fetch helpers."],
  ["Source policy", "packages/core/src/source-policy.ts", "Allowlist and denylist rules that decide what can enter the index."],
  ["Markdown parsing", "packages/core/src/markdown.ts", "Frontmatter parsing and heading-based chunking."],
  ["Smoke gates", "scripts/smoke-local.mjs", "Local end-to-end gate for sync, auth, tools/list, search, fetch, and denied guesses."],
  ["Remote gate", "scripts/smoke-remote.mjs", "Production/remote gate for OAuth-protected deployed endpoints."],
];

const curatedDeepDiveFiles = [
  "api/index.ts",
  "apps/cli/src/index.ts",
  "apps/obsidian-plugin/src/main.ts",
  "apps/server/src/app.ts",
  "apps/server/src/auth.ts",
  "apps/server/src/bootstrap.ts",
  "apps/server/src/config.ts",
  "apps/server/src/index.ts",
  "apps/server/src/mcp.ts",
  "apps/server/src/oauth.ts",
  "apps/server/src/store.ts",
  "packages/core/src/hash.ts",
  "packages/core/src/indexer.ts",
  "packages/core/src/markdown.ts",
  "packages/core/src/paths.ts",
  "packages/core/src/redaction.ts",
  "packages/core/src/search.ts",
  "packages/core/src/source-policy.ts",
  "packages/core/src/types.ts",
];

const curatedRanges = {
  "api/index.ts": [
    [1, 1, "This imports the shared server bootstrapper from the workspace app package so Vercel can create the same Express app used locally."],
    [3, 3, "This builds the configured Express app at module load time for Vercel's serverless function runtime."],
    [5, 5, "This exports the Express app as the default Vercel Function handler."],
  ],
  "apps/cli/src/index.ts": [
    [1, 6, "These imports give the CLI filesystem/path access, command-line parsing, and the shared buildVaultIndex function from core."],
    [8, 10, "These lines locate the repository root and create the Commander program object that defines the CLI."],
    [12, 22, "This block defines every command-line option: vault path, vault name, public URL, output path, report path, server URL, and sync token."],
    [24, 32, "This type assertion tells TypeScript the shape of parsed CLI options so the rest of the file can use named option fields safely."],
    [34, 39, "This calls buildVaultIndex with the chosen vault settings. At this point scanning, policy checks, redaction, chunking, and metadata creation happen in core."],
    [41, 45, "If --out was provided, this block writes the generated index JSON to disk, creating parent folders first."],
    [47, 69, "If --server was provided, this block posts the generated documents, timestamp, and stats to the remote /admin/sync endpoint using the admin sync token."],
    [71, 75, "This prints a compact JSON summary so a human or automation can see when the index was generated, which vault was scanned, and what the stats were."],
  ],
  "apps/server/src/app.ts": [
    [11, 11, "This resolves the repository public/ folder from the compiled server file location so static landing/wiki assets can be served."],
    [13, 24, "This starts Express app creation: create the app, merge allowed origins with the public base URL, install CORS/body parsing/static wiki assets, and attach the store to requests."],
    [26, 34, "These routes register OAuth endpoints and serve the public landing page plus the conceptual wiki without authentication."],
    [36, 49, "These routes serve health and OAuth protected-resource metadata, which clients use to discover auth requirements."],
    [51, 68, "This admin sync route requires the sync token, validates the payload shape, replaces the stored index, and returns updated health."],
    [70, 79, "This private note route requires user auth and fetches a single indexed document by id for citation URLs."],
    [81, 97, "This shared MCP handler catches unexpected MCP errors and returns a JSON-RPC internal-error response if headers were not already sent."],
    [99, 99, "This POST /mcp route is the main authenticated JSON-RPC MCP endpoint for tools/list and tools/call requests."],
    [100, 129, "This GET /mcp route supports Streamable HTTP SSE clients by requiring Accept: text/event-stream, opening an SSE response, and sending keepalives."],
    [131, 140, "This DELETE /mcp route explicitly rejects unsupported deletion with Method Not Allowed while advertising GET and POST as the supported methods."],
    [142, 147, "These final lines return the configured app and de-duplicate origins after trimming trailing slashes."],
  ],
  "apps/server/src/auth.ts": [
    [5, 11, "This list defines the request headers browser clients may send during CORS preflight, including MCP protocol/session headers."],
    [13, 25, "This middleware protects admin sync with a static bearer token and returns 401 when the token is absent or wrong."],
    [27, 49, "This middleware protects user-facing vault routes. It accepts either the temporary static access token or a valid OAuth token, otherwise it sends a protected-resource challenge."],
    [51, 59, "This builds OAuth protected-resource metadata so clients know the MCP resource URL, authorization server, scopes, bearer method, and documentation URL."],
    [61, 76, "This middleware checks Origin only when an Origin header exists, allowing server-to-server MCP calls while rejecting forbidden browser origins."],
    [78, 104, "This CORS middleware handles browser preflight: reject unknown origins, set allow/expose headers, update Vary, and return 204 for OPTIONS."],
    [106, 123, "These helpers parse bearer tokens, check origin membership, and append Origin to the Vary header without duplicating it."],
    [126, 144, "This verifies OAuth access tokens. It uses the local HMAC secret for the self-hosted OAuth mode or a remote JWKS URL for external providers."],
    [146, 157, "This sends an OAuth-style 401 challenge with a WWW-Authenticate header pointing clients to protected-resource metadata."],
  ],
  "apps/server/src/bootstrap.ts": [
    [1, 3, "These imports bring together config loading, the two storage implementations, and Express app creation."],
    [5, 17, "This function loads runtime config, chooses Postgres when DATABASE_URL exists or JSON storage otherwise, loads existing data if available, and returns app/config/store together."],
  ],
  "apps/server/src/config.ts": [
    [4, 15, "This type describes the full runtime configuration the server needs: host, port, URLs, storage, auth tokens, origins, and OAuth settings."],
    [17, 25, "This type describes OAuth resource-server settings: issuer, audience, authorization server, JWKS or HMAC secret, owner password, and scopes."],
    [27, 39, "This begins config loading, reads static/OAuth auth inputs, and fails fast unless user auth and sync auth are both configured."],
    [40, 45, "This resolves the repository root, chooses the local index file, and normalizes the public base URL by removing a trailing slash."],
    [46, 64, "This returns the complete ServerConfig object, including derived /mcp resource URL, database URL, allowed origins, and OAuth config."],
    [66, 68, "This helper de-duplicates allowed origins after normalizing trailing slashes."],
    [70, 98, "This reads OAuth env vars, detects when OAuth is absent, validates required OAuth pieces when present, and returns normalized scopes."],
  ],
  "apps/server/src/index.ts": [
    [1, 2, "The shebang and import make this file the Node CLI entrypoint for running the server outside Vercel."],
    [4, 8, "This creates the configured app and starts listening on the configured host/port, then logs the local URL."],
    [10, 17, "This handles SIGINT and SIGTERM by closing the HTTP server, closing the store if needed, and then exiting cleanly."],
  ],
  "apps/server/src/mcp.ts": [
    [7, 14, "This section defines the ChatGPT result-component URI and the instruction text sent to MCP clients. The instructions mark the server read-only, treat note text as untrusted context, and warn that guessed paths should not work."],
    [16, 25, "This schema defines note summaries for list-style tools. It is the compact card shape: id, title, path, tags, status, type, freshness, and Obsidian URI."],
    [27, 46, "This schema defines search results. It includes what matched, where it lives, snippets, scores, metadata, and explanation fields that help ChatGPT decide what to fetch next."],
    [48, 55, "This schema defines fetch output. Fetch tools return full indexed text plus citation URL, Obsidian URI, and metadata."],
    [57, 68, "This creates the MCP server, applies shared instructions, declares logging, and registers the ChatGPT result component resource before tools are listed."],
    [70, 90, "This compatibility search tool accepts a query and optional filters, defaults to section results, advertises ChatGPT output metadata, calls store.searchVault, and returns both structured data and a readable result summary."],
    [92, 111, "This note-level search tool groups matches by note path so ChatGPT can show one result per note instead of one result per heading chunk."],
    [113, 132, "This section-level search tool searches heading chunks, which is better when the user needs the exact section where a phrase appears."],
    [134, 154, "This list_notes tool lets clients browse indexed notes by scope, tag, status, type, limit, and cursor without requiring a keyword search."],
    [156, 171, "This recent_notes tool returns recently updated indexed notes, optionally narrowed to a path scope."],
    [173, 189, "This active_projects tool exposes active project notes from the allowlisted index and supports pagination."],
    [191, 208, "This fetch-by-id tool only returns documents already present in the index; unknown or denied ids return the standard unavailable response."],
    [210, 227, "This fetch-by-path tool accepts an exact vault-relative path, but still only succeeds when that path is already indexed and allowlisted."],
    [229, 246, "This index-status tool gives safe counts, freshness, and policy scopes without exposing note contents."],
    [248, 269, "This debug_search tool explains query normalization and likely reasons for few or zero results, without bypassing the allowlist."],
    [274, 293, "This handles one stateless MCP HTTP request. It creates a fresh MCP server and streamable transport, connects them, handles the request body, then closes resources on completion or error."],
    [295, 313, "These helpers define shared read-only tool annotations and ChatGPT tool metadata, including _meta.ui.resourceUri, the compatibility output-template key, and short invocation status text."],
    [315, 351, "This registers the ChatGPT HTML component resource at ui://vault-mcp/results.html. Apps-style clients can read the text/html;profile=mcp-app resource and render result cards without adding a new data access path."],
    [336, 350, "This converts structured tool data into MCP's dual format: machine-readable structuredContent, result metadata, and human-readable text for clients that display conversation text."],
    [352, 371, "This defines the safe not-found response used when a requested id or path is not indexed or not available under the source policy."],
    [373, 405, "These local types describe the shapes consumed by the prose-summary helpers without changing the public MCP output schemas."],
    [407, 425, "This formats search results into readable ChatGPT text with titles, paths, match reasons, fetch ids, snippets, and a next action."],
    [428, 449, "This formats note-list results into readable ChatGPT text with paths, metadata, pagination guidance, and a fetch-by-path next action."],
    [451, 468, "This formats fetched note content with citation details and an explicit safety reminder that vault text is reference material, not instructions."],
    [470, 512, "These helpers format index status, debug-search output, match reasons, and long text snippets for human-readable tool responses."],
    [515, 597, "This returns the embedded HTML component. It reads ChatGPT tool output, renders result/note/fetch cards, and falls back to JSON or summary text when the result shape is unknown."],
  ],
  "packages/core/src/search.ts": [
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
  "packages/core/src/indexer.ts": [
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
    [97, 147, "These methods expose health, search, fetch, listing, status, and debug operations by delegating to pure core functions over the in-memory document array."],
    [149, 172, "These methods store OAuth client registrations and consume authorization-code or refresh-token ids in memory so local OAuth flows can prevent replay."],
    [174, 187, "This helper creates the JSON snapshot written to disk, filling in fallback stats if the sync payload did not include them."],
    [189, 196, "This line starts the Postgres-backed store used in production and creates a connection pool from DATABASE_URL."],
    [198, 249, "This line creates or verifies the production tables and indexes: metadata, vault documents, full-text search vector, OAuth token-use ledger, and OAuth client registrations."],
    [251, 253, "This closes the Postgres connection pool when the server shuts down or tests clean up."],
    [255, 283, "This line performs production sync as one transaction: delete existing documents, insert the new complete set, update metadata, commit, or roll back on failure."],
    [285, 292, "This line reports production health by counting indexed documents and returning the latest generated_at and stats values."],
    [294, 350, "These methods expose production search/fetch/list/status/debug behavior. Most load all indexed documents and reuse core logic so JSON and Postgres behavior stay aligned."],
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
  "packages/core/src/hash.ts": [
    [1, 1, "This imports Node's crypto hash function so the indexer can create content hashes and stable ids."],
    [3, 5, "This returns a full SHA-256 hex digest for text, used as a content hash for indexed note text."],
    [7, 9, "This creates a shorter stable id by hashing a deterministic string and keeping the first 24 hex characters."],
  ],
  "packages/core/src/markdown.ts": [
    [4, 13, "This type describes what the Markdown parser extracts from one note: frontmatter, body, title, tags, status, headings, wikilinks, and tasks."],
    [15, 33, "This function parses a Markdown note with gray-matter, trims the body, extracts title/tags/status/headings/wikilinks/tasks, and returns one normalized object."],
    [35, 54, "This function splits parsed Markdown into heading sections and further slices oversized sections into chunks so the MCP server returns manageable text blocks."],
    [56, 63, "This helper chooses the note title from the first H1 heading when available, otherwise it falls back to the file name."],
    [65, 88, "This helper collects tags from frontmatter arrays, frontmatter strings, and inline #tags, normalizes them, de-duplicates them, and sorts them."],
    [90, 100, "These helpers extract headings, Obsidian wikilink targets, and Markdown task text from the note body."],
    [102, 128, "This helper turns a note body into heading-based sections, preserving heading lines and associating following text with the current heading."],
    [130, 132, "This helper trims a tag and removes a leading # so tags from frontmatter and inline text compare the same way."],
  ],
  "packages/core/src/paths.ts": [
    [1, 1, "This imports Node path helpers so filesystem paths can be converted into vault-style paths."],
    [3, 5, "This converts OS-specific path separators into forward slashes, matching Obsidian vault path style."],
    [7, 9, "This converts an absolute file path into a vault-relative path suitable for policy checks and metadata."],
    [11, 13, "This builds an obsidian://open URI that can open the source note in the named Obsidian vault."],
    [15, 17, "This builds the private /notes/:id citation URL served by the hosted connector."],
  ],
  "packages/core/src/redaction.ts": [
    [1, 5, "This type describes redaction output: the redacted text, total replacement count, and counts per pattern."],
    [7, 28, "This list defines credential-like patterns removed before indexing, including private keys, bearer tokens, env secrets, password fields, and SSH public keys."],
    [30, 46, "This function applies every sensitive pattern, replaces matches with [REDACTED:name], counts replacements by pattern, and returns the redacted note text."],
  ],
  "packages/core/src/source-policy.ts": [
    [3, 14, "These path prefixes are denied before content is indexed, covering credentials, daily notes, finance, identity, legal, vehicles, faith, and archives."],
    [16, 18, "This exact-path denylist blocks individual sensitive or review-gated files that should never enter V1."],
    [20, 30, "These tag fragments deny notes marked sensitive, credential-related, financial, legal, identity, review, or Excalidraw."],
    [32, 55, "These exact and prefix allowlists define which selected reference notes are eligible for V1 indexing."],
    [57, 60, "The policy first rejects non-Markdown inputs; only Markdown notes can become indexed documents."],
    [62, 69, "These checks reject exact denied paths and denied prefixes before considering any allow rules."],
    [71, 78, "These checks reject notes with sensitive tags or review/sensitive statuses."],
    [80, 90, "These checks allow the Task Hub and active project home notes, while denying inactive project homes."],
    [92, 100, "These final checks allow selected references, explicitly deny unselected 40 Reference notes, and deny everything else by default."],
    [103, 113, "These helpers build allow/deny decision objects and normalize tags for case-insensitive tag checks."],
  ],
  "packages/core/src/types.ts": [
    [1, 11, "These types describe source-policy decisions and the policy metadata stored on every indexed document."],
    [13, 24, "This metadata type records where an indexed chunk came from: path, heading, note title, chunk index, tags, status, timestamp, content hash, Obsidian URI, and policy evidence."],
    [26, 33, "This type is the core indexed document shape: stable id, title, text, private citation URL, optional Obsidian URI, and metadata."],
    [35, 54, "This type describes one search result returned to clients, including snippets, score, match reasons, expanded terms, and source metadata."],
    [56, 60, "These small response aliases define search responses and fetch responses."],
    [62, 85, "These types define note-summary list results and pagination options for list-style tools."],
    [87, 97, "These types define search modes and search filter options."],
    [99, 117, "These types define safe index-status and debug-search responses."],
    [119, 139, "These types define indexing stats, the full generated vault index, and the payload accepted by /admin/sync."],
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
    title: "Source Appendix",
    body: `
      <section class="hero">
        <p class="eyebrow">Vault MCP Connector Wiki</p>
        <h1>Source appendix.</h1>
        <p class="lead">This generated appendix is for exact file lookup after you have read the rebuild tutorial. It covers ${records.length} authored text files and ${totalLines.toLocaleString()} lines with explanatory notes beside source lines.</p>
        <p><a href="/wiki/tutorial.html">Start with the rebuild tutorial</a> · <a href="/wiki/">Back to the wiki home</a></p>
      </section>

      <section>
        <h2>How to use this appendix</h2>
        <div class="grid two">
          <div class="card">
            <h3>Read the tutorial first</h3>
            <p>The rebuild tutorial explains the system in build order. Use this appendix when you want to inspect a specific file after that.</p>
          </div>
          <div class="card">
            <h3>Look up exact source</h3>
            <p>Each row has the line number, exact source, and an explanatory note. Closing brackets and punctuation are included for complete source lookup, not because they are the best learning path.</p>
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
          <p><a href="index.html">Back to source appendix</a> · <a href="/wiki/tutorial.html">Rebuild tutorial</a> · <a href="/wiki/">Back to wiki home</a></p>
      </section>

      <section>
        <h2>How to read this file</h2>
        <div class="card">
          <p>${escapeHtml(fileGuidance(file.path))}</p>
        </div>
      </section>

      <section>
        <h2>Source with explanatory notes</h2>
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
  <main>${body.trimEnd()}
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
    ["apps/cli/src/index.ts", "CLI for building and optionally syncing the vault index."],
    ["packages/core/src/indexer.ts", "Vault scanner, source policy application, redaction, chunking, metadata, and report output."],
    ["packages/core/src/search.ts", "Read-only search, list, recent, active project, fetch, status, and diagnostics helpers."],
    ["packages/core/src/source-policy.ts", "V1 allowlist and denylist rules."],
    ["packages/core/src/markdown.ts", "Markdown frontmatter parsing and heading chunking."],
    ["packages/core/src/redaction.ts", "Credential-like string redaction before indexing."],
    ["packages/core/src/types.ts", "Shared TypeScript types for index documents, search results, and stats."],
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
