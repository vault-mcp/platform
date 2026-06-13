import pg from "pg";
import { POSTGRES_MIGRATIONS, runPostgresMigrations } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_SMOKE_DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run Vault MCP Postgres migrations.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const result = await runPostgresMigrations(pool);
  const total = POSTGRES_MIGRATIONS.length;
  const response = {
    ok: true,
    total_migrations: total,
    applied_count: result.applied.length,
    applied: result.applied.map((migration) => ({
      id: migration.id,
      description: migration.description,
    })),
    already_applied: result.alreadyApplied,
    pending: result.pending,
  };

  console.log(JSON.stringify(response, null, 2));
} catch (error) {
  console.error("Vault MCP Postgres migration failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
