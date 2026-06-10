import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVaultIndex } from "./indexer.js";
import {
  activeProjects,
  debugSearch,
  fetchDocument,
  fetchDocumentByPath,
  getIndexStatus,
  listNotes,
  recentNotes,
  searchDocuments,
  searchNotes,
  searchSections,
} from "./search.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("buildVaultIndex", () => {
  it("indexes only allowlisted notes and blocks guessed denied ids", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-test-"));
    await write(path.join(root, "20 Projects/Test Project/Project Home.md"), `---
status: active
tags:
  - type/project
---
# Test Project

This project mentions remote MCP and citations.
`);
    await write(path.join(root, "40 Reference/Obsidian/Test Reference.md"), `---
status: active
tags:
  - type/reference
---
# Obsidian Reference

Remote connector reference content.
`);
    await write(path.join(root, "40 Reference/Business Development/Proposal Archive.md"), `---
status: active
tags:
  - type/reference
---
# Proposal Archive

Business-development proposal text about remote MCP should not appear.
`);
    await write(path.join(root, "02 Daily/2026-06-07.md"), `---
status: active
---
# Daily

Sensitive daily text about remote MCP should not appear.
`);
    await write(path.join(root, "00 System/Credentials/Secret.md"), `---
status: active
---
# Secret

credential remote MCP text should not appear.
`);

    const index = await buildVaultIndex({
      vaultRoot: root,
      vaultName: "Test Vault",
      publicBaseUrl: "https://example.test",
      now: new Date("2026-06-08T00:00:00.000Z"),
    });

    expect(index.stats.scanned_markdown).toBe(5);
    expect(index.stats.denied_markdown).toBe(3);
    expect(index.documents).toHaveLength(2);
    expect(index.documents.map((document) => document.metadata.path)).toEqual([
      "20 Projects/Test Project/Project Home.md",
      "40 Reference/Obsidian/Test Reference.md",
    ]);

    const results = searchDocuments(index.documents, "remote MCP");
    expect(results.results).toHaveLength(2);
    expect(results.results[0].metadata.path).not.toContain("02 Daily");
    expect(results.results.map((result) => result.metadata.path)).not.toContain("40 Reference/Business Development/Proposal Archive.md");
    expect(fetchDocument(index.documents, "guessed-denied-id")).toBeNull();
  });

  it("keeps document ids stable when note content changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-id-test-"));
    const notePath = path.join(root, "20 Projects/Test Project/Project Home.md");
    await write(notePath, `---
status: active
---
# Test Project

Original project context.
`);

    const firstIndex = await buildVaultIndex({
      vaultRoot: root,
      vaultName: "Test Vault",
      publicBaseUrl: "https://example.test",
      now: new Date("2026-06-08T00:00:00.000Z"),
    });
    const firstDocument = firstIndex.documents[0];

    await write(notePath, `---
status: active
---
# Test Project

Updated project context with new implementation details.
`);

    const secondIndex = await buildVaultIndex({
      vaultRoot: root,
      vaultName: "Test Vault",
      publicBaseUrl: "https://example.test",
      now: new Date("2026-06-08T01:00:00.000Z"),
    });
    const secondDocument = secondIndex.documents[0];

    expect(secondDocument.id).toBe(firstDocument.id);
    expect(secondDocument.url).toBe(firstDocument.url);
    expect(secondDocument.text).toContain("Updated project context");
    expect(secondDocument.metadata.content_hash).not.toBe(firstDocument.metadata.content_hash);
  });

  it("supports note discovery, note search, section search, path fetch, and safe diagnostics against a fixture vault", async () => {
    const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mcp-report-test-"));
    const reportPath = path.join(reportDir, "Vault MCP Index Report.md");
    const index = await buildVaultIndex({
      vaultRoot: path.join(repoRoot, "fixtures", "vault"),
      vaultName: "Fixture Vault",
      publicBaseUrl: "https://example.test",
      now: new Date("2026-06-10T12:00:00.000Z"),
      reportPath,
    });

    expect(index.documents.map((document) => document.metadata.path).sort()).toEqual([
      "20 Projects/Test Project/Project Home.md",
      "40 Reference/Recipes/Crisp Twilight.md",
      "40 Reference/Self Hosting/Home Server Playbook.md",
    ]);
    expect(index.stats.denied_by_rule["deny-prefix"]).toBe(2);
    expect(index.stats.redacted_documents).toBe(1);
    expect(index.stats.redactions_by_pattern?.["env-secret"]).toBe(1);

    const firstPage = listNotes(index.documents, { limit: 2 });
    expect(firstPage.notes).toHaveLength(2);
    expect(firstPage.next_cursor).toBe("2");
    const secondPage = listNotes(index.documents, { cursor: firstPage.next_cursor ?? undefined });
    expect(secondPage.notes).toHaveLength(1);

    expect(listNotes(index.documents, { scope: "40 Reference/", type: "reference" }).notes.map((note) => note.path)).toEqual([
      "40 Reference/Recipes/Crisp Twilight.md",
      "40 Reference/Self Hosting/Home Server Playbook.md",
    ]);
    expect(recentNotes(index.documents, "40 Reference/", 1).notes[0].path.startsWith("40 Reference/")).toBe(true);
    expect(activeProjects(index.documents).notes.map((note) => note.path)).toEqual([
      "20 Projects/Test Project/Project Home.md",
    ]);

    const noteResults = searchNotes(index.documents, { query: "Home Server Playbook" });
    expect(noteResults.results[0]).toMatchObject({
      type: "note",
      title: "Home Server Playbook",
      path: "40 Reference/Self Hosting/Home Server Playbook.md",
    });

    const sectionResults = searchSections(index.documents, { query: "docker tunnel" });
    expect(sectionResults.results[0]).toMatchObject({
      type: "section",
      note_title: "Home Server Playbook",
      section_title: "Home Server Playbook",
      path: "40 Reference/Self Hosting/Home Server Playbook.md",
    });

    const drinkResults = searchNotes(index.documents, { query: "drink note" });
    expect(drinkResults.results[0].path).toBe("40 Reference/Recipes/Crisp Twilight.md");
    expect(drinkResults.results[0].match_reasons).toContain("expanded_text_match:cocktail");

    const byPath = fetchDocumentByPath(index.documents, "40 Reference/Recipes/Crisp Twilight.md");
    expect(byPath?.title).toBe("Crisp Twilight");
    expect(byPath?.obsidian_uri).toContain("obsidian://open");
    expect(byPath?.text).toContain("[REDACTED:env-secret]");
    expect(byPath?.text).not.toContain("fixture-secret-value");
    expect(fetchDocumentByPath(index.documents, "Credentials/API Keys.md")).toBeNull();

    const status = getIndexStatus(index.documents, index.stats, index.generated_at);
    expect(status.indexed_note_count).toBe(3);
    expect(status.indexed_section_count).toBe(3);
    expect(status.excluded_scopes).toContain("02 Daily/");

    const debug = debugSearch(index.documents, "Crisp Twilight", undefined, index.generated_at);
    expect(debug.result_count).toBeGreaterThan(0);
    expect(debug.last_indexed_at).toBe("2026-06-10T12:00:00.000Z");

    const report = await fs.readFile(reportPath, "utf8");
    expect(report).toContain("# Vault MCP Index Report");
    expect(report).toContain("- Indexed notes: 3");
    expect(report).toContain("- Redactions for env-secret: 1");
    expect(report).not.toContain("fixture-secret-value");
  });
});

async function write(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}
