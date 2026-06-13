import { describe, expect, it } from "vitest";
import type { SyncPayload } from "@vault-mcp/core";
import {
  describeCaughtError,
  describeHttpFailure,
  normalizeServerBaseUrl,
  pluginSafetyDisclosure,
  summarizeSyncResponse,
} from "./plugin-helpers";

describe("plugin helpers", () => {
  it("normalizes base server URLs and rejects route URLs", () => {
    expect(normalizeServerBaseUrl(" https://vault-mcp-connector.vercel.app/ ")).toBe("https://vault-mcp-connector.vercel.app");
    expect(normalizeServerBaseUrl("http://127.0.0.1:3333")).toBe("http://127.0.0.1:3333");
    expect(() => normalizeServerBaseUrl("vault-mcp-connector.vercel.app")).toThrow("Include https://");
    expect(() => normalizeServerBaseUrl("https://vault-mcp-connector.vercel.app/mcp")).toThrow("base server URL");
  });

  it("turns HTTP failures into user-actionable messages", () => {
    expect(describeHttpFailure("sync", 401, "{\"error\":\"unauthorized\"}")).toContain("Check the sync token");
    expect(describeHttpFailure("proposal check", 404, "")).toContain("endpoint was not found");
    expect(describeHttpFailure("sync", 500, "database unavailable")).toContain("server failed");
    expect(describeCaughtError("sync", new Error("Load failed"))).toContain("could not reach the server");
  });

  it("summarizes sync responses using server and local counts", () => {
    const summary = summarizeSyncResponse(syncPayload(), JSON.stringify({
      ok: true,
      vault: {
        document_count: 12,
        generated_at: "2026-06-13T18:00:00.000Z",
      },
    }));

    expect(summary.serverDocumentCount).toBe(12);
    expect(summary.serverGeneratedAt).toBe("2026-06-13T18:00:00.000Z");
    expect(summary.message).toContain("12 server chunks now indexed");
    expect(summary.message).toContain("Scanned 10 notes");
    expect(summary.message).toContain("denied 3");
    expect(summary.message).toContain("review 2");
    expect(summary.message).toContain("redacted 1");
  });

  it("describes the plugin safety boundary from current settings", () => {
    const disclosure = pluginSafetyDisclosure({
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
    });

    expect(disclosure.title).toBe("Safety boundary");
    expect(disclosure.summary).toContain("derived index");
    expect(disclosure.summary).toContain("source of truth");
    expect(disclosure.points.join("\n")).toContain("Preview before syncing");
    expect(disclosure.points.join("\n")).toContain("does not directly edit Obsidian files");
    expect(disclosure.points.join("\n")).toContain("review required");
    expect(disclosure.points.join("\n")).toContain("backup and audit notes");
  });

  it("calls out direct apply as experimental", () => {
    const disclosure = pluginSafetyDisclosure({
      indexMode: "manual_only",
      writeMode: "direct_apply",
      writeAuditFolder: "Audit",
    });

    expect(disclosure.points.join("\n")).toContain("Direct apply is selected");
    expect(disclosure.points.join("\n")).toContain("experimental");
    expect(disclosure.points.join("\n")).toContain("Audit");
  });
});

function syncPayload(): SyncPayload {
  return {
    tenant_id: "default",
    vault_id: "default",
    installation_id: "test",
    vault_name: "Test",
    generated_at: "2026-06-13T17:59:00.000Z",
    policy_version: "test",
    index_mode: "rules_plus_approvals",
    documents: Array.from({ length: 8 }, (_, index) => ({
      id: `doc-${index}`,
      tenant_id: "default",
      vault_id: "default",
      installation_id: "test",
      title: `Doc ${index}`,
      text: "content",
      url: `https://example.com/notes/doc-${index}`,
      obsidian_uri: `obsidian://open?vault=Test&file=Doc%20${index}.md`,
      metadata: {
        tenant_id: "default",
        vault_id: "default",
        installation_id: "test",
        path: `Doc ${index}.md`,
        heading: null,
        note_title: `Doc ${index}`,
        chunk_index: index,
        tags: [],
        status: null,
        updated_at: "2026-06-13T17:59:00.000Z",
        content_hash: `hash-${index}`,
        obsidian_uri: `obsidian://open?vault=Test&file=Doc%20${index}.md`,
        source_policy: {
          allowed: true,
          reason: "test",
          matched_rule: "test",
        },
      },
    })),
    stats: {
      scanned_markdown: 10,
      allowed_documents: 8,
      denied_markdown: 3,
      denied_by_rule: {},
      review_required_markdown: 2,
      reviewed_by_rule: {},
      redacted_documents: 1,
      redactions_by_pattern: {},
    },
  };
}
