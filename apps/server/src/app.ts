import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import { applyCors, protectedResourceMetadata, requireAllowedOrigin, requireBearerToken, requireUserAuth } from "./auth.js";
import { handleStatelessMcpRequest } from "./mcp.js";
import { attachOAuthStore, registerOAuthRoutes } from "./oauth.js";
import type { IndexStore } from "./store.js";
import {
  DEFAULT_INSTALLATION_ID,
  DEFAULT_POLICY_VERSION,
  DEFAULT_TENANT_ID,
  defaultIndexPolicy,
  summarizeIndexPolicy,
  type SyncManifest,
  type SyncPayload,
  type WriteOperation,
  type WriteProposalStatus,
} from "@vault-mcp/core";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");
const WRITE_OPERATIONS = new Set<WriteOperation>(["append_to_note", "replace_note", "patch_note", "create_note", "update_frontmatter", "rename_note"]);
const WRITE_PROPOSAL_STATUSES = new Set<WriteProposalStatus>(["pending", "approved", "rejected", "applied", "conflict", "failed"]);

export function createApp(config: ServerConfig, store: IndexStore) {
  const app = express();
  const allowedOrigins = uniqueOrigins([...config.allowedOrigins, config.publicBaseUrl]);
  app.use(applyCors(allowedOrigins));
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
  app.use("/assets", express.static(path.join(publicDir, "assets"), { index: false }));
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

  app.get("/healthz", async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      ...await store.health(),
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
      await handleStatelessMcpRequest(req, res, store);
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
