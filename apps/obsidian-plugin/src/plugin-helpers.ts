import type { SyncPayload } from "@vault-mcp/core";

export type SyncResultSummary = {
  message: string;
  serverDocumentCount: number | null;
  serverGeneratedAt: string | null;
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
