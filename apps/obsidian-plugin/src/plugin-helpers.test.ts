import { describe, expect, it } from "vitest";
import type { SyncPayload } from "@vault-mcp/core";
import {
  describeCaughtError,
  describeHttpFailure,
  normalizeServerBaseUrl,
  pluginConfigurationChecklist,
  pluginSafetyDisclosure,
  pluginSetupGuide,
  summarizeServerStatus,
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

  it("marks a configured plugin as ready to sync", () => {
    const checklist = pluginConfigurationChecklist({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
    });

    expect(checklist.readyToPreview).toBe(true);
    expect(checklist.readyToSync).toBe(true);
    expect(checklist.items.every((item) => item.status !== "blocked")).toBe(true);
    expect(checklist.items.find((item) => item.label === "Write mode")?.message).toContain("Review required");
  });

  it("blocks sync for invalid route URLs, missing tokens, missing vault ids, and empty scopes", () => {
    const checklist = pluginConfigurationChecklist({
      serverUrl: "https://vault-mcp-connector.vercel.app/mcp",
      syncToken: "",
      vaultId: "",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "",
      includePrefixes: [],
      excludePrefixes: [],
    });

    expect(checklist.readyToPreview).toBe(false);
    expect(checklist.readyToSync).toBe(false);
    expect(checklist.items.filter((item) => item.status === "blocked").map((item) => item.label)).toEqual([
      "Server URL",
      "Sync token",
      "Vault id",
      "Index scope",
      "Write audit folder",
    ]);
    expect(checklist.items.find((item) => item.label === "Exclusions")?.status).toBe("warning");
  });

  it("warns when direct apply is selected", () => {
    const checklist = pluginConfigurationChecklist({
      serverUrl: "http://127.0.0.1:3333",
      syncToken: "secret",
      vaultId: "demo",
      indexMode: "manual_only",
      writeMode: "direct_apply",
      writeAuditFolder: "Audit",
      includePrefixes: [],
      excludePrefixes: ["Private/"],
    });

    expect(checklist.readyToPreview).toBe(true);
    expect(checklist.readyToSync).toBe(true);
    expect(checklist.items.find((item) => item.label === "Write mode")?.status).toBe("warning");
    expect(checklist.items.find((item) => item.label === "Index scope")?.message).toContain("Manual-only");
  });

  it("builds a plugin-first setup guide with hosting and client cards", () => {
    const guide = pluginSetupGuide({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "sync-secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
    });

    expect(guide.title).toBe("Start here");
    expect(guide.summary).toContain("start from this plugin");
    expect(guide.endpoint).toBe("https://vault-mcp-connector.vercel.app/mcp");
    expect(guide.steps.map((step) => step.label)).toContain("Choose hosting");
    expect(guide.steps.find((step) => step.label === "Add the sync token")?.status).toBe("done");
    expect(guide.hostingOptions.map((option) => option.label)).toEqual([
      "Managed Vault MCP",
      "Guided Vercel self-host",
      "Advanced manual hosting",
    ]);
    expect(guide.clientCards.map((card) => card.label)).toEqual([
      "ChatGPT",
      "Claude",
      "Codex",
      "MCP Inspector",
    ]);
    expect(guide.clientCards.find((card) => card.label === "ChatGPT")?.auth).toContain("Do not paste the sync token");
    expect(guide.recoveryActions.join("\n")).toContain("Rotate the server admin sync token");
  });

  it("blocks setup steps when the server URL and sync token are missing", () => {
    const guide = pluginSetupGuide({
      serverUrl: "not a url",
      syncToken: "",
      vaultId: "",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "",
      includePrefixes: [],
      excludePrefixes: [],
    });

    expect(guide.endpoint).toBe("Set a valid server URL first.");
    expect(guide.steps.find((step) => step.label === "Choose hosting")?.status).toBe("next");
    expect(guide.steps.find((step) => step.label === "Add the sync token")?.status).toBe("blocked");
    expect(guide.steps.find((step) => step.label === "Connect an MCP client")?.message).toContain("Clients use OAuth");
  });

  it("summarizes a healthy server and authorized vault status", () => {
    const summary = summarizeServerStatus({
      ok: true,
      service: {
        version: "0.1.0",
        mcp_resource_url: "https://vault-mcp-connector.vercel.app/mcp",
      },
      storage: {
        kind: "postgres",
        ok: true,
        migrations: ["0001_initial_vault_mcp_schema"],
      },
      document_count: 240,
      vault_count: 1,
      last_sync_at: "2026-06-25T21:00:00.000Z",
    }, {
      vault_id: "default",
      vault_name: "Copied vault",
      document_count: 240,
      generated_at: "2026-06-25T21:00:00.000Z",
    }, true);

    expect(summary.status).toBe("ready");
    expect(summary.title).toContain("ready");
    expect(summary.message).toContain("sync token");
    expect(summary.facts).toContain("Server version: 0.1.0");
    expect(summary.facts).toContain("Configured vault chunks: 240");
    expect(summary.facts.join("\n")).toContain("0001_initial_vault_mcp_schema");
  });

  it("treats reachable health without a token as a warning", () => {
    const summary = summarizeServerStatus({
      ok: true,
      storage: { kind: "json", ok: true },
      document_count: 0,
      vault_count: 0,
    }, null, false);

    expect(summary.status).toBe("warning");
    expect(summary.message).toContain("Add the admin sync token");
    expect(summary.facts).toContain("Storage: json (ready)");
  });

  it("blocks when server storage is unhealthy", () => {
    const summary = summarizeServerStatus({
      ok: false,
      storage: { kind: "postgres", ok: false },
      document_count: 0,
      vault_count: 0,
    }, null, true);

    expect(summary.status).toBe("blocked");
    expect(summary.message).toContain("storage is reporting a failure");
    expect(summary.facts).toContain("Storage: postgres (not ready)");
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
