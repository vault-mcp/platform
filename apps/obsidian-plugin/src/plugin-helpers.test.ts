import { describe, expect, it } from "vitest";
import type { LocalFsWriteOperation, SyncPayload } from "@vault-mcp/core";
import {
  buildLocalClientInstructions,
  buildLocalServerLaunchCommand,
  buildLocalServerSpawnConfig,
  buildLocalClientConnectionBundle,
  describeCaughtError,
  describeHttpFailure,
  normalizeServerBaseUrl,
  parsePluginSetupBundle,
  pluginConfigurationChecklist,
  pluginLocalServerStatus,
  pluginSafetyDisclosure,
  pluginSetupGuide,
  localServerPortCandidates,
  summarizeServerStatus,
  summarizeSyncResponse,
  validateLocalServerCompatibility,
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

  it("parses plugin setup bundles from the hosted setup page", () => {
    const bundle = parsePluginSetupBundle(JSON.stringify({
      type: "vault-mcp-plugin-setup",
      version: 1,
      serverUrl: "https://example-vault-mcp.vercel.app/",
      syncToken: "sync-token",
      tenantId: "personal",
      vaultId: "main-vault",
      indexMode: "manual_only",
      writeMode: "review_required",
    }));

    expect(bundle).toEqual({
      serverUrl: "https://example-vault-mcp.vercel.app",
      syncToken: "sync-token",
      tenantId: "personal",
      vaultId: "main-vault",
      indexMode: "manual_only",
      writeMode: "review_required",
    });
  });

  it("defaults optional setup bundle fields to safe private-alpha values", () => {
    const bundle = parsePluginSetupBundle(JSON.stringify({
      serverUrl: "https://example-vault-mcp.vercel.app",
      syncToken: "sync-token",
    }));

    expect(bundle.tenantId).toBe("default");
    expect(bundle.vaultId).toBe("default");
    expect(bundle.indexMode).toBe("rules_plus_approvals");
    expect(bundle.writeMode).toBe("review_required");
  });

  it("rejects invalid plugin setup bundles", () => {
    expect(() => parsePluginSetupBundle("not json")).toThrow("valid JSON");
    expect(() => parsePluginSetupBundle(JSON.stringify({ type: "other", serverUrl: "https://example.com", syncToken: "secret" }))).toThrow("not a Vault MCP");
    expect(() => parsePluginSetupBundle(JSON.stringify({ serverUrl: "https://example.com/mcp", syncToken: "secret" }))).toThrow("base server URL");
    expect(() => parsePluginSetupBundle(JSON.stringify({ serverUrl: "https://example.com", syncToken: "secret", indexMode: "everything" }))).toThrow("indexMode");
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

  it("describes planned local desktop server mode without claiming it can start", () => {
    const status = pluginLocalServerStatus({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerModeEnabled: true,
      localServerPort: 38791,
      localServerKeepAlive: false,
    });

    expect(status.status).toBe("planned");
    expect(status.endpoint).toBe("http://127.0.0.1:38791/mcp");
    expect(status.canStart).toBe(false);
    expect(status.message).toContain("cannot start");
    expect(status.facts.join("\n")).toContain("Sidecar status: not configured");
    expect(status.facts.join("\n")).toContain("Bundled sidecar: not installed");
  });

  it("rejects invalid local desktop server ports", () => {
    const status = pluginLocalServerStatus({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 80,
    });

    expect(status.status).toBe("invalid");
    expect(status.endpoint).toContain("1024");
    expect(status.canStart).toBe(false);
  });

  it("builds local server port candidates from the preferred port", () => {
    expect(localServerPortCandidates(38791, 4)).toEqual([38791, 38792, 38793, 38794]);
    expect(localServerPortCandidates(80, 3)).toEqual([38791, 38792, 38793]);
    expect(localServerPortCandidates(65534, 5)).toEqual([65534, 65535]);
    expect(localServerPortCandidates(38791, 0)).toEqual([38791]);
  });

  it("reports generated local credentials and data folder", () => {
    const status = pluginLocalServerStatus({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp-local-token",
      localServerSyncToken: "sync-local-token",
      localServerCredentialsCreatedAt: "2026-07-02T12:00:00.000Z",
      localServerProjectDir: "/Users/example/vault-mcp/platform",
      localServerCommand: "/opt/homebrew/bin/npm",
    });

    expect(status.canStart).toBe(true);
    expect(status.facts.join("\n")).toContain("Local credentials: generated");
    expect(status.facts.join("\n")).toContain("Credentials created: 2026-07-02T12:00:00.000Z");
    expect(status.facts.join("\n")).toContain("Local data folder: Plugin Data/Local Server");
    expect(status.facts.join("\n")).toContain("Developer project folder: /Users/example/vault-mcp/platform");
    expect(status.facts.join("\n")).toContain("Developer command: /opt/homebrew/bin/npm");
  });

  it("builds a local client connection bundle without exposing the sync token", () => {
    const bundle = buildLocalClientConnectionBundle({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "remote-sync-secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerMcpToken: "mcp-local-token",
      localServerSyncToken: "sync-local-token",
      localFsAccessMode: "write",
      localFsReadRoots: ["/Users/example/Vault"],
      localFsWriteRoots: ["/Users/example/Vault/20 Projects"],
      localFsWriteOperations: ["write_file", "move_path"] as LocalFsWriteOperation[],
      localFsMaxReadBytes: 8192,
      localFsMaxSearchResults: 12,
      localFsMaxSearchFiles: 345,
      localFsAccessTtlMinutes: 45,
      localFsRequireUserIntent: true,
      localFsUserIntentPhrase: "approve local access",
    });

    expect(bundle?.endpoint).toBe("http://127.0.0.1:38791/mcp");
    expect(bundle?.authorization_header).toBe("Bearer mcp-local-token");
    expect(bundle?.example_mcp_config.mcpServers["vault-mcp-local"].headers.Authorization).toBe("Bearer mcp-local-token");
    expect(bundle?.local_filesystem).toMatchObject({
      access_mode: "write",
      read_roots: ["/Users/example/Vault"],
      write_roots: ["/Users/example/Vault/20 Projects"],
      write_operations: ["write_file", "move_path"],
      max_read_bytes: 8192,
      max_search_results: 12,
      max_search_files: 345,
      access_ttl_minutes: 45,
      require_user_intent: true,
      user_intent_phrase: "approve local access",
      example_tool_arguments: {
        user_intent: "approve local access",
      },
    });
    expect(bundle?.local_filesystem.client_rules.join("\n")).toContain("local_fs_policy");
    expect(JSON.stringify(bundle)).not.toContain("sync-local-token");
    expect(JSON.stringify(bundle)).not.toContain("remote-sync-secret");
    expect(buildLocalClientConnectionBundle({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "remote-sync-secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 80,
      localServerMcpToken: "mcp-local-token",
    })).toBeNull();
  });

  it("builds local client instructions without embedding local secrets", () => {
    const instructions = buildLocalClientInstructions({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "remote-sync-secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerMcpToken: "mcp-local-token",
      localServerSyncToken: "sync-local-token",
      localFsAccessMode: "god",
      localFsAccessTtlMinutes: 15,
      localFsRequireUserIntent: true,
      localFsUserIntentPhrase: "approve local access",
    });

    expect(instructions).toContain("Endpoint: http://127.0.0.1:38791/mcp");
    expect(instructions).toContain('user_intent: "approve local access"');
    expect(instructions).toContain("Filesystem mode: god");
    expect(instructions).toContain("15 minutes after local server start or refresh");
    expect(instructions).not.toContain("mcp-local-token");
    expect(instructions).not.toContain("sync-local-token");
    expect(instructions).not.toContain("remote-sync-secret");
  });

  it("builds local server launch and spawn commands only when credentials are ready", () => {
    expect(buildLocalServerLaunchCommand({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
    })).toBeNull();

    expect(buildLocalServerSpawnConfig({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp token",
      localServerSyncToken: "sync token",
    })).toBeNull();

    const command = buildLocalServerLaunchCommand({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp token",
      localServerSyncToken: "sync'token",
      localServerProjectDir: "/Users/example/Vault MCP/platform",
    });

    expect(command).toContain("cd '/Users/example/Vault MCP/platform' && npm run local-server -- --port 38791");
    expect(command).toContain("--data-dir 'Plugin Data/Local Server'");
    expect(command).toContain("--mcp-token 'mcp token'");
    expect(command).toContain("--sync-token 'sync'\\''token'");

    expect(buildLocalServerSpawnConfig({
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals",
      writeMode: "review_required",
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp token",
      localServerSyncToken: "sync token",
      localServerProjectDir: "/Users/example/vault-mcp/platform",
      localServerCommand: "/opt/homebrew/bin/npm",
    })).toEqual({
      command: "/opt/homebrew/bin/node",
      cwd: "/Users/example/vault-mcp/platform",
      args: [
        "scripts/start-local-server.mjs",
        "--port",
        "38791",
        "--data-dir",
        "Plugin Data/Local Server",
        "--mcp-token",
        "mcp token",
        "--sync-token",
        "sync token",
      ],
    });
  });

  it("prefers a bundled sidecar over the developer project folder when present", () => {
    const settings = {
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals" as const,
      writeMode: "review_required" as const,
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp token",
      localServerSyncToken: "sync token",
      localServerSidecarDir: "/Users/example/Vault/.obsidian/plugins/vault-mcp/sidecar",
      localServerCommand: "/opt/homebrew/bin/npm",
      localFsAccessMode: "read" as const,
      localFsReadRoots: ["/Users/example/Vault"],
      localFsAccessTtlMinutes: 30,
    };

    const status = pluginLocalServerStatus(settings);
    expect(status.canStart).toBe(true);
    expect(status.title).toBe("Local desktop server bundled sidecar is ready");
    expect(status.facts.join("\n")).toContain("Sidecar status: packaged sidecar installed");
    expect(status.facts.join("\n")).toContain("Bundled sidecar: /Users/example/Vault/.obsidian/plugins/vault-mcp/sidecar");

    const command = buildLocalServerLaunchCommand(settings);
    expect(command).toContain("cd '/Users/example/Vault/.obsidian/plugins/vault-mcp/sidecar' && /opt/homebrew/bin/node start-local-server.mjs");
    expect(command).toContain("--fs-access 'read'");
    expect(command).toContain("--fs-access-ttl-minutes '30'");
    expect(command).toContain("--fs-require-user-intent 'true'");
    expect(command).toContain("--fs-user-intent-phrase 'use local filesystem'");

    expect(buildLocalServerSpawnConfig(settings)).toEqual({
      command: "/opt/homebrew/bin/node",
      cwd: "/Users/example/Vault/.obsidian/plugins/vault-mcp/sidecar",
      args: [
        "start-local-server.mjs",
        "--port",
        "38791",
        "--data-dir",
        "Plugin Data/Local Server",
        "--mcp-token",
        "mcp token",
        "--sync-token",
        "sync token",
        "--fs-access",
        "read",
        "--fs-roots",
        "/Users/example/Vault",
        "--fs-write-operations",
        "write_file",
        "--fs-access-ttl-minutes",
        "30",
        "--fs-require-user-intent",
        "true",
        "--fs-user-intent-phrase",
        "use local filesystem",
      ],
    });
  });

  it("accepts only the expected local server service, version, and endpoint", () => {
    const healthy = validateLocalServerCompatibility({
      ok: true,
      service: {
        name: "vault-mcp-connector",
        version: "0.1.0",
        mcp_resource_url: "http://127.0.0.1:38791/mcp",
      },
      storage: {
        kind: "json",
        ok: true,
      },
    }, "0.1.0", "http://127.0.0.1:38791/mcp");

    expect(healthy.ok).toBe(true);
    expect(healthy.message).toContain("compatible");

    expect(validateLocalServerCompatibility({
      ok: true,
      service: {
        name: "other-service",
        version: "0.1.0",
        mcp_resource_url: "http://127.0.0.1:38791/mcp",
      },
      storage: { ok: true },
    }, "0.1.0", "http://127.0.0.1:38791/mcp").message).toContain("other-service");

    expect(validateLocalServerCompatibility({
      ok: true,
      service: {
        name: "vault-mcp-connector",
        version: "0.0.9",
        mcp_resource_url: "http://127.0.0.1:38791/mcp",
      },
      storage: { ok: true },
    }, "0.1.0", "http://127.0.0.1:38791/mcp").message).toContain("does not match plugin version");

    expect(validateLocalServerCompatibility({
      ok: true,
      service: {
        name: "vault-mcp-connector",
        version: "0.1.0",
        mcp_resource_url: "http://127.0.0.1:39999/mcp",
      },
      storage: { ok: true },
    }, "0.1.0", "http://127.0.0.1:38791/mcp").message).toContain("does not match expected endpoint");
  });

  it("adds local filesystem launch flags only when filesystem access is enabled", () => {
    const settings = {
      serverUrl: "https://vault-mcp-connector.vercel.app",
      syncToken: "secret",
      vaultId: "default",
      indexMode: "rules_plus_approvals" as const,
      writeMode: "review_required" as const,
      writeAuditFolder: "00 System/Vault MCP Write Audit",
      includePrefixes: ["20 Projects/"],
      excludePrefixes: ["02 Daily/"],
      localServerPort: 38791,
      localServerDataDir: "Plugin Data/Local Server",
      localServerMcpToken: "mcp token",
      localServerSyncToken: "sync token",
      localServerProjectDir: "/Users/example/vault-mcp/platform",
      localFsAccessMode: "write" as const,
      localFsReadRoots: ["/Users/example/Vault One", "/Users/example/Reference"],
      localFsWriteRoots: ["/Users/example/Vault One"],
      localFsWriteOperations: ["write_file", "edit_file", "create_directory", "copy_path", "move_path", "delete_path"] as LocalFsWriteOperation[],
      localFsMaxReadBytes: 4096,
      localFsMaxSearchResults: 25,
      localFsMaxSearchFiles: 500,
      localFsAccessTtlMinutes: 45,
      localFsRequireUserIntent: true,
      localFsUserIntentPhrase: "approve local access",
    };

    const status = pluginLocalServerStatus(settings);
    expect(status.facts.join("\n")).toContain("Local filesystem access: write");
    expect(status.facts.join("\n")).toContain("Local filesystem read roots: /Users/example/Vault One, /Users/example/Reference");
    expect(status.facts.join("\n")).toContain("Local filesystem write roots: /Users/example/Vault One");
    expect(status.facts.join("\n")).toContain("Local filesystem write operations: write_file, edit_file, create_directory, copy_path, move_path, delete_path");
    expect(status.facts.join("\n")).toContain("Local filesystem search caps: 25 results, 500 files");
    expect(status.facts.join("\n")).toContain("Local filesystem session: 45 minute window");
    expect(status.facts.join("\n")).toContain("Local filesystem user intent: required (approve local access)");

    const command = buildLocalServerLaunchCommand(settings);
    expect(command).toContain("--fs-access 'write'");
    expect(command).toContain("--fs-roots '/Users/example/Vault One,/Users/example/Reference'");
    expect(command).toContain("--fs-write-roots '/Users/example/Vault One'");
    expect(command).toContain("--fs-write-operations 'write_file,edit_file,create_directory,copy_path,move_path,delete_path'");
    expect(command).toContain("--fs-max-read-bytes '4096'");
    expect(command).toContain("--fs-max-search-results '25'");
    expect(command).toContain("--fs-max-search-files '500'");
    expect(command).toContain("--fs-access-ttl-minutes '45'");
    expect(command).toContain("--fs-require-user-intent 'true'");
    expect(command).toContain("--fs-user-intent-phrase 'approve local access'");

    expect(buildLocalServerSpawnConfig(settings)?.args).toEqual([
      "scripts/start-local-server.mjs",
      "--port",
      "38791",
      "--data-dir",
      "Plugin Data/Local Server",
      "--mcp-token",
      "mcp token",
      "--sync-token",
      "sync token",
      "--fs-access",
      "write",
      "--fs-roots",
      "/Users/example/Vault One,/Users/example/Reference",
      "--fs-write-roots",
      "/Users/example/Vault One",
      "--fs-write-operations",
      "write_file,edit_file,create_directory,copy_path,move_path,delete_path",
      "--fs-max-read-bytes",
      "4096",
      "--fs-max-search-results",
      "25",
      "--fs-max-search-files",
      "500",
      "--fs-access-ttl-minutes",
      "45",
      "--fs-require-user-intent",
      "true",
      "--fs-user-intent-phrase",
      "approve local access",
    ]);
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
      "Local desktop server",
      "Advanced manual hosting",
    ]);
    expect(guide.hostingOptions.find((option) => option.label === "Guided Vercel self-host")?.actionUrl)
      .toBe("https://vault-mcp-connector.vercel.app/setup/vercel");
    expect(guide.hostingOptions.find((option) => option.label === "Local desktop server")?.summary)
      .toContain("localhost MCP server");
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
    expect(guide.hostingOptions.find((option) => option.label === "Guided Vercel self-host")?.actionUrl)
      .toBe("https://vault-mcp-connector.vercel.app/setup/vercel");
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
