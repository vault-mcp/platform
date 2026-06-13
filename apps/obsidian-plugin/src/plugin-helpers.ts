import type { SyncPayload } from "@vault-mcp/core";

export type SyncResultSummary = {
  message: string;
  serverDocumentCount: number | null;
  serverGeneratedAt: string | null;
};

export type PluginSafetySettings = {
  indexMode: string;
  writeMode: string;
  writeAuditFolder: string;
};

export type PluginConfigurationSettings = PluginSafetySettings & {
  serverUrl: string;
  syncToken: string;
  vaultId: string;
  includePrefixes: string[];
  excludePrefixes: string[];
};

export type PluginSafetyDisclosure = {
  title: string;
  summary: string;
  points: string[];
};

export type PluginConfigurationChecklistItem = {
  label: string;
  status: "ready" | "warning" | "blocked";
  message: string;
};

export type PluginConfigurationChecklist = {
  readyToPreview: boolean;
  readyToSync: boolean;
  items: PluginConfigurationChecklistItem[];
};

type VaultSyncResponse = {
  ok?: boolean;
  vault?: {
    document_count?: number;
    generated_at?: string | null;
  };
  document_count?: number;
  generated_at?: string | null;
  error?: string;
};

export function normalizeServerBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Server URL is required. Use the base URL, for example https://vault-mcp-connector.vercel.app.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Server URL is not a valid URL. Include https:// for production or http:// for a local server.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Server URL must start with https:// for production or http:// for local testing.");
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Server URL should be the base server URL, not a route. Remove paths like /mcp, /admin, or /oauth.");
  }

  return url.toString().replace(/\/$/, "");
}

export function describeHttpFailure(action: string, status: number, responseText: string): string {
  const serverError = parseServerError(responseText);
  const suffix = serverError ? ` Server said: ${serverError}` : "";

  if (status === 401 || status === 403) {
    return `${capitalize(action)} was not authorized. Check the sync token and server URL.${suffix}`;
  }
  if (status === 404) {
    return `${capitalize(action)} endpoint was not found. Check that the server URL is the base URL and that the deployed server is current.${suffix}`;
  }
  if (status >= 500) {
    return `${capitalize(action)} reached the server, but the server failed. Check server logs or try again.${suffix}`;
  }
  if (status >= 400) {
    return `${capitalize(action)} was rejected by the server with HTTP ${status}.${suffix}`;
  }
  return `${capitalize(action)} failed with unexpected HTTP ${status}.${suffix}`;
}

export function describeCaughtError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|network|load failed|could not connect|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return `${capitalize(action)} could not reach the server. Check the server URL, network connection, and whether the server is running.`;
  }
  return message;
}

export function summarizeSyncResponse(payload: SyncPayload, responseText: string): SyncResultSummary {
  const parsed = safeJson(responseText) as VaultSyncResponse | null;
  const serverDocumentCount = typeof parsed?.vault?.document_count === "number"
    ? parsed.vault.document_count
    : typeof parsed?.document_count === "number"
      ? parsed.document_count
      : null;
  const serverGeneratedAt = typeof parsed?.vault?.generated_at === "string"
    ? parsed.vault.generated_at
    : typeof parsed?.generated_at === "string"
      ? parsed.generated_at
      : null;
  const localChunks = payload.documents.length;
  const scanned = payload.stats?.scanned_markdown ?? 0;
  const denied = payload.stats?.denied_markdown ?? 0;
  const review = payload.stats?.review_required_markdown ?? 0;
  const redacted = payload.stats?.redacted_documents ?? 0;
  const acceptedText = serverDocumentCount === null
    ? `${localChunks} chunk${localChunks === 1 ? "" : "s"} sent`
    : `${serverDocumentCount} server chunk${serverDocumentCount === 1 ? "" : "s"} now indexed`;

  return {
    message: `${acceptedText}. Scanned ${scanned} note${scanned === 1 ? "" : "s"}; denied ${denied}; review ${review}; redacted ${redacted}.`,
    serverDocumentCount,
    serverGeneratedAt,
  };
}

export function pluginSafetyDisclosure(settings: PluginSafetySettings): PluginSafetyDisclosure {
  const writePoint = settings.writeMode === "direct_apply"
    ? `Direct apply is selected. Treat this as experimental: matching proposals can be applied only after local safety checks, backup creation, and audit logging in ${settings.writeAuditFolder}.`
    : `Write mode is review required. Remote clients can create proposals, but the plugin must approve and apply supported writes locally after safety checks.`;

  return {
    title: "Safety boundary",
    summary: "Vault MCP syncs approved context to the server as a derived index. The local vault remains the source of truth.",
    points: [
      `Index mode is ${settings.indexMode}. Preview before syncing to see which notes are allowed, denied, or held for review.`,
      "Exclude rules run before include and manual allow rules, so denied folders stay denied unless you change the policy.",
      "The server stores searchable chunks and write proposals; it does not directly edit Obsidian files.",
      writePoint,
      `Local write applies create backup and audit notes under ${settings.writeAuditFolder}.`,
    ],
  };
}

export function pluginConfigurationChecklist(settings: PluginConfigurationSettings): PluginConfigurationChecklist {
  const items: PluginConfigurationChecklistItem[] = [];
  let normalizedServerUrl: string | null = null;

  try {
    normalizedServerUrl = normalizeServerBaseUrl(settings.serverUrl);
    items.push({
      label: "Server URL",
      status: "ready",
      message: `Using ${normalizedServerUrl}.`,
    });
  } catch (error) {
    items.push({
      label: "Server URL",
      status: "blocked",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  items.push(settings.syncToken.trim()
    ? {
        label: "Sync token",
        status: "ready",
        message: "A sync token is saved. It is hidden in the UI and used only for admin sync/proposal requests.",
      }
    : {
        label: "Sync token",
        status: "blocked",
        message: "Add the server admin sync token before syncing or checking write proposals.",
      });

  items.push(settings.vaultId.trim()
    ? {
        label: "Vault id",
        status: "ready",
        message: `This vault will sync as ${settings.vaultId.trim()}.`,
      }
    : {
        label: "Vault id",
        status: "blocked",
        message: "Choose a stable vault id before syncing.",
      });

  items.push(settings.includePrefixes.length > 0 || settings.indexMode === "manual_only"
    ? {
        label: "Index scope",
        status: "ready",
        message: settings.indexMode === "manual_only"
          ? "Manual-only mode is selected; only explicit manual allow paths or prefixes can sync."
          : `${settings.includePrefixes.length} include rule${settings.includePrefixes.length === 1 ? "" : "s"} configured.`,
      }
    : {
        label: "Index scope",
        status: "blocked",
        message: "Add at least one include prefix or switch to manual-only mode before syncing.",
      });

  items.push(settings.excludePrefixes.length > 0
    ? {
        label: "Exclusions",
        status: "ready",
        message: `${settings.excludePrefixes.length} exclude rule${settings.excludePrefixes.length === 1 ? "" : "s"} configured. Exclusions win before include and manual allow rules.`,
      }
    : {
        label: "Exclusions",
        status: "warning",
        message: "No exclude rules are configured. Review sensitive folders before syncing.",
      });

  items.push(settings.writeMode === "direct_apply"
    ? {
        label: "Write mode",
        status: "warning",
        message: "Direct apply is experimental. Use review required for private-alpha testing unless deliberately validating direct apply.",
      }
    : {
        label: "Write mode",
        status: "ready",
        message: "Review required is selected. Writes stay proposal-first and require plugin-side approval/apply.",
      });

  items.push(settings.writeAuditFolder.trim()
    ? {
        label: "Write audit folder",
        status: "ready",
        message: `Backups and audit notes will be written under ${settings.writeAuditFolder.trim()}.`,
      }
    : {
        label: "Write audit folder",
        status: "blocked",
        message: "Set a vault-relative audit folder before applying write proposals.",
      });

  return {
    readyToPreview: !items.some((item) => item.label === "Server URL" && item.status === "blocked"),
    readyToSync: !items.some((item) => item.status === "blocked"),
    items,
  };
}

function parseServerError(responseText: string): string | null {
  const parsed = safeJson(responseText);
  if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
    return parsed.error;
  }
  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
