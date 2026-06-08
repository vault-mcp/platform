#!/usr/bin/env node
import { createConfiguredApp } from "./bootstrap.js";

const { app, config, store } = await createConfiguredApp();

const httpServer = app.listen(config.port, config.host, () => {
  console.log(`Vault MCP Connector listening on http://${config.host}:${config.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  httpServer.close(() => {
    void store.close?.().finally(() => process.exit(0));
  });
}
