import { createConfiguredApp } from "../apps/server/src/bootstrap.js";

const { app } = await createConfiguredApp();

export default app;
