import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import { applyCors, protectedResourceMetadata, requireAllowedOrigin, requireBearerToken, requireUserAuth, userAuthContext } from "./auth.js";
import { handleStatelessMcpRequest } from "./mcp.js";
import { attachOAuthStore, registerOAuthRoutes } from "./oauth.js";
import type { IndexStore } from "./store.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./version.js";
import {
  DEFAULT_INSTALLATION_ID,
  DEFAULT_POLICY_VERSION,
  DEFAULT_TENANT_ID,
  LOCAL_FS_TOOL_NAMES,
  defaultIndexPolicy,
  summarizeIndexPolicy,
  type LocalAgentToolDefinition,
  type LocalAgentStatus,
  type LocalFsAccessMode,
  type LocalFsPolicy,
  type SyncManifest,
  type SyncPayload,
  type WriteOperation,
  type WriteProposalStatus,
} from "@vault-mcp/core";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");
const WRITE_OPERATIONS = new Set<WriteOperation>(["append_to_note", "replace_note", "create_note", "update_frontmatter", "rename_note"]);
const WRITE_PROPOSAL_STATUSES = new Set<WriteProposalStatus>(["pending", "approved", "rejected", "applied", "conflict", "failed"]);
const LOCAL_FS_ACCESS_MODES = new Set<LocalFsAccessMode>(["off", "read", "write", "god"]);
const LOCAL_FS_TOOL_NAME_SET = new Set<string>(LOCAL_FS_TOOL_NAMES);

export function createApp(config: ServerConfig, store: IndexStore) {
  const app = express();
  const allowedOrigins = uniqueOrigins([...config.allowedOrigins, config.publicBaseUrl]);
  app.use(applyCors(allowedOrigins));
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
  app.use("/assets", express.static(path.join(publicDir, "assets"), { index: false }));
  app.use("/setup", express.static(path.join(publicDir, "setup"), { index: false }));
  app.use("/wiki", express.static(path.join(publicDir, "wiki"), { index: false }));
  app.use("/wiki/files", express.static(path.join(publicDir, "wiki", "files"), { index: "index.html" }));
  app.use((req, _res, next) => {
    attachOAuthStore(req, store);
    next();
  });

  registerOAuthRoutes(app, config);

  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get(["/wiki", "/wiki/"], (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "wiki", "index.html"));
  });

  app.get(["/setup/vercel", "/setup/vercel/"], (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "setup", "vercel.html"));
  });

  app.get("/healthz", async (_req: Request, res: Response) => {
    const health = await store.health();
    res.status(health.storage.ok ? 200 : 503).json({
      ok: health.storage.ok,
      service: {
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
        public_base_url: config.publicBaseUrl,
        mcp_resource_url: config.mcpResourceUrl,
      },
      ...health,
    });
  });

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata(config));
  });

  app.get("/.well-known/oauth-protected-resource/mcp", (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata(config));
  });

  app.post("/admin/sync", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const payload = req.body as Partial<SyncPayload>;
    if (!Array.isArray(payload.documents)) {
      res.status(400).json({ error: "documents array is required" });
      return;
    }

    await store.replace({
      documents: payload.documents,
      generated_at: payload.generated_at,
      stats: payload.stats,
    });

    res.json({
      ok: true,
      ...await store.health(),
    });
  });

  app.post("/admin/vaults/register", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const body = req.body as Partial<SyncManifest>;
    const vaultId = normalizeId(body.vault_id, "default");
    const tenantId = normalizeId(body.tenant_id, DEFAULT_TENANT_ID);
    const installationId = normalizeId(body.installation_id, DEFAULT_INSTALLATION_ID);
    const indexMode = body.index_mode ?? "rules_plus_approvals";
    const policy = defaultIndexPolicy(indexMode);
    const manifest: SyncManifest = {
      tenant_id: tenantId,
      vault_id: vaultId,
      installation_id: installationId,
      vault_name: typeof body.vault_name === "string" && body.vault_name.trim() ? body.vault_name.trim() : vaultId,
      generated_at: new Date().toISOString(),
      policy_version: body.policy_version ?? DEFAULT_POLICY_VERSION,
      index_mode: indexMode,
      policy_summary: body.policy_summary ?? summarizeIndexPolicy(policy),
    };
    await store.registerVault(manifest);
    res.json({ ok: true, manifest });
  });

  app.get("/admin/vaults", requireBearerToken(config.syncToken), async (_req: Request, res: Response) => {
    res.json({ vaults: await store.listVaults() });
  });

  app.get("/admin/vaults/:vaultId/status", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const vaultId = paramValue(req.params.vaultId);
    res.json(await store.vaultStatus(vaultId));
  });

  app.delete("/admin/vaults/:vaultId", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const vaultId = paramValue(req.params.vaultId);
    await store.deleteVault(vaultId);
    res.json({ ok: true, vault_id: vaultId });
  });

  app.post("/admin/vaults/:vaultId/sync", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const vaultId = paramValue(req.params.vaultId);
    const payload = req.body as Partial<SyncPayload>;
    if (!Array.isArray(payload.documents)) {
      res.status(400).json({ error: "documents array is required" });
      return;
    }

    await store.replace({
      ...payload,
      vault_id: vaultId,
      documents: payload.documents,
    });

    res.json({
      ok: true,
      vault: await store.vaultStatus(vaultId),
    });
  });

  app.get("/admin/vaults/:vaultId/write-proposals", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const vaultId = paramValue(req.params.vaultId);
    res.json({ proposals: await store.listWriteProposals(vaultId) });
  });

  app.post("/admin/vaults/:vaultId/write-proposals", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const vaultId = paramValue(req.params.vaultId);
    const body = req.body as {
      operation?: WriteOperation;
      target_path?: string;
      base_content_hash?: string | null;
      proposed_content?: string;
      proposed_patch?: string;
      requester?: string;
    };
    if (!body.operation || !body.target_path) {
      res.status(400).json({ error: "operation and target_path are required" });
      return;
    }
    if (!WRITE_OPERATIONS.has(body.operation)) {
      res.status(400).json({ error: "invalid_operation" });
      return;
    }

    const now = new Date().toISOString();
    const proposal = await store.createWriteProposal({
      id: randomUUID(),
      tenant_id: DEFAULT_TENANT_ID,
      vault_id: vaultId,
      operation: body.operation,
      target_path: body.target_path,
      base_content_hash: body.base_content_hash ?? null,
      proposed_content: body.proposed_content,
      proposed_patch: body.proposed_patch,
      requester: body.requester ?? "admin-api",
      status: "pending",
      created_at: now,
      updated_at: now,
      audit: [{
        status: "pending",
        actor: body.requester ?? "admin-api",
        message: "Write proposal created.",
        created_at: now,
      }],
    });

    res.status(201).json({ proposal });
  });

  app.patch("/admin/write-proposals/:proposalId", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    const proposalId = paramValue(req.params.proposalId);
    const body = req.body as { status?: WriteProposalStatus; actor?: string; message?: string };
    if (!body.status) {
      res.status(400).json({ error: "status is required" });
      return;
    }
    if (!WRITE_PROPOSAL_STATUSES.has(body.status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }

    const proposal = await store.updateWriteProposalStatus(
      proposalId,
      body.status,
      body.actor ?? "admin-api",
      body.message ?? `Status changed to ${body.status}.`,
    );
    if (!proposal) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({ proposal });
  });

  app.post("/admin/vaults/:vaultId/local-agent/heartbeat", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    if (!config.remoteLocalFsEnabled) {
      res.status(404).json({ error: "remote_local_fs_disabled" });
      return;
    }
    const vaultId = paramValue(req.params.vaultId);
    const body = req.body as {
      tenant_id?: string;
      installation_id?: string;
      agent_version?: string;
      policy?: unknown;
      tools?: unknown;
      connected_at?: string;
    };
    const installationId = normalizeId(body.installation_id, "");
    if (!installationId || !isLocalFsPolicy(body.policy) || !isLocalAgentTools(body.tools)) {
      res.status(400).json({ error: "installation_id, a valid local filesystem policy, and local tool catalog are required" });
      return;
    }
    const now = new Date().toISOString();
    const agent: LocalAgentStatus = {
      tenant_id: normalizeId(body.tenant_id, DEFAULT_TENANT_ID),
      vault_id: vaultId,
      installation_id: installationId,
      agent_version: normalizeId(body.agent_version, "unknown"),
      policy: body.policy,
      tools: body.tools,
      connected_at: normalizeIsoDate(body.connected_at, now),
      last_seen_at: now,
    };
    await store.upsertLocalAgentStatus(agent);
    res.json({ ok: true, agent });
  });

  app.get("/admin/vaults/:vaultId/local-agent/status", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    if (!config.remoteLocalFsEnabled) {
      res.status(404).json({ error: "remote_local_fs_disabled" });
      return;
    }
    const vaultId = paramValue(req.params.vaultId);
    const tenantId = typeof req.query.tenant_id === "string" ? req.query.tenant_id.trim() || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID;
    const installationId = typeof req.query.installation_id === "string" ? req.query.installation_id : undefined;
    res.json({ agent: await store.getLocalAgentStatus(tenantId, vaultId, installationId) });
  });

  app.get("/admin/vaults/:vaultId/local-access-requests/next", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    if (!config.remoteLocalFsEnabled) {
      res.status(404).json({ error: "remote_local_fs_disabled" });
      return;
    }
    const vaultId = paramValue(req.params.vaultId);
    const tenantId = typeof req.query.tenant_id === "string" ? req.query.tenant_id.trim() || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID;
    const installationId = typeof req.query.installation_id === "string" ? req.query.installation_id.trim() : "";
    if (!installationId) {
      res.status(400).json({ error: "installation_id is required" });
      return;
    }
    res.json({ request: await store.claimLocalAccessRequest(tenantId, vaultId, installationId) });
  });

  app.post("/admin/vaults/:vaultId/local-access-requests/:requestId/result", requireBearerToken(config.syncToken), async (req: Request, res: Response) => {
    if (!config.remoteLocalFsEnabled) {
      res.status(404).json({ error: "remote_local_fs_disabled" });
      return;
    }
    const vaultId = paramValue(req.params.vaultId);
    const requestId = paramValue(req.params.requestId);
    const body = req.body as {
      installation_id?: string;
      tenant_id?: string;
      status?: "completed" | "failed";
      result?: unknown;
      error?: unknown;
    };
    const installationId = normalizeId(body.installation_id, "");
    const tenantId = normalizeId(body.tenant_id, DEFAULT_TENANT_ID);
    if (!installationId || (body.status !== "completed" && body.status !== "failed")) {
      res.status(400).json({ error: "installation_id and completed or failed status are required" });
      return;
    }
    const result = body.status === "completed" && isRecord(body.result) ? body.result : null;
    const error = body.status === "failed" ? normalizeLocalAccessError(body.error) : null;
    if (body.status === "completed" && !result) {
      res.status(400).json({ error: "completed local access requests require an object result" });
      return;
    }
    const request = await store.completeLocalAccessRequest(requestId, tenantId, vaultId, installationId, body.status, result, error);
    if (!request) {
      res.status(409).json({ error: "request_not_running_or_installation_mismatch" });
      return;
    }
    res.json({ ok: true, request });
  });

  app.get("/notes/:id", requireUserAuth(config), async (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const document = await store.fetch(id);
    if (!document) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json(document);
  });

  const handleMcp = async (req: Request, res: Response) => {
    try {
      await handleStatelessMcpRequest(req, res, store, config, userAuthContext(req));
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", requireAllowedOrigin(allowedOrigins), requireUserAuth(config), handleMcp);
  app.get("/mcp", requireAllowedOrigin(allowedOrigins), requireUserAuth(config), (req: Request, res: Response) => {
    const accept = req.get("accept") ?? "";
    if (!accept.includes("text/event-stream")) {
      res.status(406).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Not Acceptable: Client must accept text/event-stream.",
        },
        id: null,
      });
      return;
    }

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });
    res.flushHeaders();
    res.write(": connected\n\n");

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
    });
  });

  app.delete("/mcp", requireAllowedOrigin(allowedOrigins), requireUserAuth(config), (_req: Request, res: Response) => {
    res.status(405).set("Allow", "GET, POST").json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  return app;
}

function uniqueOrigins(origins: string[]): string[] {
  return [...new Set(origins.map((origin) => origin.replace(/\/$/, "")))];
}

function normalizeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isLocalFsPolicy(value: unknown): value is LocalFsPolicy {
  if (!isRecord(value) || !LOCAL_FS_ACCESS_MODES.has(value.mode as LocalFsAccessMode)) {
    return false;
  }
  return isStringArray(value.read_roots)
    && isStringArray(value.write_roots)
    && isStringArray(value.write_operations)
    && isPositiveInteger(value.max_read_bytes)
    && isPositiveInteger(value.max_search_results)
    && isPositiveInteger(value.max_search_files)
    && (value.expires_at === null || isIsoDate(value.expires_at))
    && typeof value.require_user_intent === "boolean"
    && typeof value.user_intent_phrase === "string"
    && value.user_intent_phrase.length > 0;
}

function isLocalAgentTools(value: unknown): value is LocalAgentToolDefinition[] {
  return Array.isArray(value)
    && value.length <= LOCAL_FS_TOOL_NAMES.length
    && value.every((entry) => isRecord(entry)
      && typeof entry.name === "string"
      && LOCAL_FS_TOOL_NAME_SET.has(entry.name)
      && typeof entry.description === "string"
      && entry.description.length <= 2_000
      && isRecord(entry.input_schema)
      && typeof entry.read_only === "boolean"
      && typeof entry.destructive === "boolean");
}

function normalizeLocalAccessError(value: unknown): { code: string; message: string } {
  if (!isRecord(value)) {
    return { code: "LOCAL_ACCESS_FAILED", message: "The desktop agent reported a failure." };
  }
  return {
    code: normalizeId(value.code, "LOCAL_ACCESS_FAILED").slice(0, 100),
    message: normalizeId(value.message, "The desktop agent reported a failure.").slice(0, 2_000),
  };
}

function normalizeIsoDate(value: unknown, fallback: string): string {
  return isIsoDate(value) ? new Date(value).toISOString() : fallback;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
