import express, { type Request, type Response } from "express";
import type { ServerConfig } from "./config.js";
import { applyCors, protectedResourceMetadata, requireAllowedOrigin, requireBearerToken, requireUserAuth } from "./auth.js";
import { handleStatelessMcpRequest } from "./mcp.js";
import { attachOAuthStore, registerOAuthRoutes } from "./oauth.js";
import type { IndexStore } from "./store.js";
import type { SyncPayload } from "@vault-mcp/vault-core";

export function createApp(config: ServerConfig, store: IndexStore) {
  const app = express();
  app.use(applyCors(config.allowedOrigins));
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
  app.use((req, _res, next) => {
    attachOAuthStore(req, store);
    next();
  });

  registerOAuthRoutes(app, config);

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

  app.post("/mcp", requireAllowedOrigin(config.allowedOrigins), requireUserAuth(config), handleMcp);
  app.get("/mcp", requireAllowedOrigin(config.allowedOrigins), requireUserAuth(config), (req: Request, res: Response) => {
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

  app.delete("/mcp", requireAllowedOrigin(config.allowedOrigins), requireUserAuth(config), (_req: Request, res: Response) => {
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
