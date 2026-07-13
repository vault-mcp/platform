import { loadConfig } from "./config.js";
import { JsonIndexStore, PostgresIndexStore, type IndexStore } from "./store.js";
import { createApp } from "./app.js";

export async function createConfiguredApp(env = process.env) {
  const config = loadConfig(env);
  const store: IndexStore = config.databaseUrl
    ? new PostgresIndexStore(config.databaseUrl)
    : new JsonIndexStore(config.indexFile);
  await store.load?.();

  return {
    app: createApp(config, store),
    config,
    store,
  };
}
