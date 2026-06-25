import { describe, expect, it } from "vitest";
import { chunkMarkdown, parseMarkdownNote } from "./markdown.js";

describe("parseMarkdownNote", () => {
  it("extracts frontmatter, title, tags, wikilinks, and tasks", () => {
    const parsed = parseMarkdownNote(`---
status: active
tags:
  - type/project
  - topic/mcp
---
# Vault MCP Connector

- [ ] Build the thing #task/next
- Link to [[00 System/Task Hub|Task Hub]]
`, "20 Projects/Vault MCP Connector/Project Home.md");

    expect(parsed.title).toBe("Vault MCP Connector");
    expect(parsed.status).toBe("active");
    expect(parsed.tags).toContain("type/project");
    expect(parsed.tags).toContain("topic/mcp");
    expect(parsed.tags).toContain("task/next");
    expect(parsed.wikilinks).toEqual(["00 System/Task Hub"]);
    expect(parsed.tasks).toEqual(["Build the thing #task/next"]);
  });

  it("handles string tags and notes without frontmatter", () => {
    const withStringTags = parseMarkdownNote(`---
tags: "type/project, topic/mcp"
---
No heading body.
`, "20 Projects/Test.md");
    const withoutFrontmatter = parseMarkdownNote("Body #inline/tag", "40 Reference/Plain.md");

    expect(withStringTags.tags).toEqual(["topic/mcp", "type/project"]);
    expect(withStringTags.title).toBe("Test");
    expect(withoutFrontmatter.frontmatter).toEqual({});
    expect(withoutFrontmatter.tags).toEqual(["inline/tag"]);
    expect(withoutFrontmatter.title).toBe("Plain");
  });
});

describe("chunkMarkdown", () => {
  it("splits content by headings", () => {
    const parsed = parseMarkdownNote(`# Note

Intro

## Section

Detail
`, "40 Reference/Test.md");

    expect(chunkMarkdown(parsed)).toEqual([
      { heading: "Note", text: "# Note\n\nIntro" },
      { heading: "Section", text: "## Section\n\nDetail" },
    ]);
  });
});
