import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { createConfiguredApp } from "./bootstrap.js";

export type EmbeddedLocalServer = {
  close(): Promise<void>;
};

export async function startEmbeddedLocalServer(env: NodeJS.ProcessEnv): Promise<EmbeddedLocalServer> {
  const { app, config, store } = await createConfiguredApp(env);
  await mkdir(path.dirname(config.indexFile), { recursive: true });

  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(config.port, config.host, () => resolve(candidate));
    candidate.once("error", reject);
  }).catch(async (error) => {
    await store.close?.();
    throw error;
  });

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await store.close?.();
    },
  };
}
