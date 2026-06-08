import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVaultIndex } from "./indexer.js";
import { fetchDocument, searchDocuments } from "./search.js";

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
});

async function write(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}
