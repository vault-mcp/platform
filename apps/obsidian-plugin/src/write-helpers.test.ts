import { describe, expect, it } from "vitest";
import type { WriteOperation, WriteProposal } from "@vault-mcp/core";
import {
  analyzeWriteProposalWithAdapter,
  applyWriteProposalWithAdapter,
  buildDiffPreview,
  contentAfterProposal,
  frontmatterPatchPreview,
  parseFrontmatterPatch,
  previewForProposal,
  renameTargetPath,
  type WriteApplyAdapter,
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

  it("applies create, append, and replace proposals with backup and audit notes", async () => {
    const vault = new FakeVault();

    const createResult = await applyWriteProposalWithAdapter(proposal("create_note", {
      id: "create-1",
      target_path: "20 Projects/New.md",
      proposed_content: "# New\n",
    }), vault.adapter());
    expect(vault.readPath("20 Projects/New.md")).toBe("# New\n");
    expect(vault.readPath(createResult.backupPath)).toBe("");
    expect(vault.readPath(createResult.auditPath)).toContain("Final target path: `20 Projects/New.md`");

    await applyWriteProposalWithAdapter(proposal("append_to_note", {
      id: "append-1",
      target_path: "20 Projects/New.md",
      proposed_content: "\nMore",
    }), vault.adapter());
    expect(vault.readPath("20 Projects/New.md")).toBe("# New\n\nMore");

    await applyWriteProposalWithAdapter(proposal("replace_note", {
      id: "replace-1",
      target_path: "20 Projects/New.md",
      proposed_content: "# Replaced\n",
    }), vault.adapter());
    expect(vault.readPath("20 Projects/New.md")).toBe("# Replaced\n");
  });

  it("applies frontmatter patches through the adapter and writes audit evidence", async () => {
    const vault = new FakeVault({
      "20 Projects/Test.md": "---\nstatus: draft\nremove_me: yes\n---\n# Test\n",
    });

    const result = await applyWriteProposalWithAdapter(proposal("update_frontmatter", {
      id: "frontmatter-1",
      target_path: "20 Projects/Test.md",
      proposed_content: JSON.stringify({
        status: "active",
        tags: ["topic/mcp", "status/active"],
        remove_me: null,
      }),
    }), vault.adapter());

    expect(vault.readPath("20 Projects/Test.md")).toBe("---\nstatus: active\ntags:\n  - topic/mcp\n  - status/active\n---\n# Test\n");
    expect(vault.readPath(result.backupPath)).toContain("status: draft");
    expect(vault.readPath(result.auditPath)).toContain("- remove_me: yes");
    expect(vault.readPath(result.auditPath)).toContain("+ tags:");
  });

  it("applies renames through the adapter and refuses destination conflicts", async () => {
    const vault = new FakeVault({
      "20 Projects/Old.md": "# Old\n",
      "20 Projects/Existing.md": "# Existing\n",
    });

    const conflict = await analyzeWriteProposalWithAdapter(proposal("rename_note", {
      target_path: "20 Projects/Old.md",
      proposed_content: "20 Projects/Existing.md",
    }), vault.adapter());
    expect(conflict.canApplyInFuture).toBe(false);
    expect(conflict.message).toContain("already exists");

    const result = await applyWriteProposalWithAdapter(proposal("rename_note", {
      id: "rename-1",
      target_path: "20 Projects/Old.md",
      proposed_content: "20 Projects/Renamed.md",
    }), vault.adapter());

    expect(vault.readPath("20 Projects/Old.md")).toBeNull();
    expect(vault.readPath("20 Projects/Renamed.md")).toBe("# Old\n");
    expect(vault.readPath(result.auditPath)).toContain("Final target path: `20 Projects/Renamed.md`");
    expect(vault.folders).toContain("00 System/Vault MCP Write Audit/2026-06-12");
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

type FakeFile = {
  path: string;
};

class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders: string[] = [];

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
  }

  adapter(): WriteApplyAdapter<FakeFile> {
    return {
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      getFile: (path) => this.files.has(path) ? { path } : null,
      readFile: async (file) => this.files.get(file.path) ?? "",
      createFile: async (path, content) => {
        if (this.files.has(path)) {
          throw new Error(`File already exists: ${path}`);
        }
        this.files.set(path, content);
      },
      processFile: async (file, updater) => {
        this.files.set(file.path, updater(this.files.get(file.path) ?? ""));
      },
      processFrontmatter: async (file, updater) => {
        const parsed = parseFrontmatter(this.files.get(file.path) ?? "");
        updater(parsed.frontmatter);
        this.files.set(file.path, serializeFrontmatter(parsed.frontmatter, parsed.body));
      },
      renameFile: async (file, newPath) => {
        const content = this.files.get(file.path);
        if (content === undefined) {
          throw new Error(`Missing file: ${file.path}`);
        }
        if (this.files.has(newPath)) {
          throw new Error(`File already exists: ${newPath}`);
        }
        this.files.delete(file.path);
        this.files.set(newPath, content);
      },
      ensureFolder: async (folder) => {
        if (folder) {
          this.folders.push(folder);
        }
      },
      now: () => new Date("2026-06-12T12:34:56.789Z"),
    };
  }

  readPath(path: string): string | null {
    return this.files.get(path) ?? null;
  }
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      continue;
    }
    const [, key, value] = keyValue;
    if (value === "") {
      const values: string[] = [];
      while (lines[index + 1]?.startsWith("  - ")) {
        index += 1;
        values.push(lines[index].slice(4));
      }
      frontmatter[key] = values;
    } else {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: match[2] };
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---", body);
  return lines.join("\n");
}
