import { describe, expect, it } from "vitest";
import type { WriteOperation, WriteProposal } from "@vault-mcp/core";
import {
  buildDiffPreview,
  contentAfterProposal,
  frontmatterPatchPreview,
  parseFrontmatterPatch,
  previewForProposal,
  renameTargetPath,
} from "./write-helpers";

describe("write proposal helpers", () => {
  it("builds append and replace content without touching unsupported operations", () => {
    expect(contentAfterProposal(proposal("append_to_note", { proposed_content: "\nnew line" }), "old")).toBe("old\nnew line");
    expect(contentAfterProposal(proposal("replace_note", { proposed_content: "replacement" }), "old")).toBe("replacement");
    expect(contentAfterProposal(proposal("update_frontmatter", { proposed_content: "{\"status\":\"active\"}" }), "old")).toBeNull();
  });

  it("validates rename targets as vault-relative markdown paths", () => {
    expect(renameTargetPath(proposal("rename_note", { proposed_content: "20 Projects/New Name.md" }))).toBe("20 Projects/New Name.md");
    expect(renameTargetPath(proposal("rename_note", { proposed_content: "/20 Projects/New Name.md" }))).toBeNull();
    expect(renameTargetPath(proposal("rename_note", { proposed_content: "20 Projects/../Private.md" }))).toBeNull();
    expect(renameTargetPath(proposal("rename_note", { proposed_content: "20 Projects/New Name.txt" }))).toBeNull();
    expect(renameTargetPath(proposal("rename_note", { proposed_content: "20 Projects/A.md\n20 Projects/B.md" }))).toBeNull();
  });

  it("parses constrained frontmatter patches and rejects unsafe shapes", () => {
    expect(parseFrontmatterPatch(proposal("update_frontmatter", {
      proposed_content: JSON.stringify({
        status: "active",
        priority: 2,
        published: false,
        tags: ["topic/mcp", "status/active"],
        old_key: null,
      }),
    }))).toEqual({
      status: "active",
      priority: 2,
      published: false,
      tags: ["topic/mcp", "status/active"],
      old_key: null,
    });

    expect(parseFrontmatterPatch(proposal("update_frontmatter", { proposed_content: "{}" }))).toBeNull();
    expect(parseFrontmatterPatch(proposal("update_frontmatter", { proposed_content: "[]" }))).toBeNull();
    expect(parseFrontmatterPatch(proposal("update_frontmatter", { proposed_content: "{\"nested\":{\"unsafe\":true}}" }))).toBeNull();
    expect(parseFrontmatterPatch(proposal("update_frontmatter", { proposed_content: "{\"mixed\":[\"ok\",{\"unsafe\":true}]}" }))).toBeNull();
    expect(parseFrontmatterPatch(proposal("update_frontmatter", { proposed_content: "not json" }))).toBeNull();
  });

  it("renders frontmatter and note previews in reviewable text", () => {
    expect(frontmatterPatchPreview({ status: "active", old_key: null })).toBe("+ status: \"active\"\n- old_key");
    expect(previewForProposal(proposal("append_to_note", { proposed_content: "\nSecond" }), "First")).toContain("+ Second");
    expect(previewForProposal(proposal("replace_note", { proposed_content: "Second" }), "First")).toBe("- First\n+ Second");
    expect(buildDiffPreview("Same", "Same")).toBe("No text changes detected.");
  });
});

function proposal(operation: WriteOperation, overrides: Partial<WriteProposal> = {}): WriteProposal {
  return {
    id: "proposal-test",
    tenant_id: "default",
    vault_id: "default",
    operation,
    target_path: "20 Projects/Test.md",
    base_content_hash: null,
    requester: "test",
    status: "pending",
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    audit: [],
    ...overrides,
  };
}
