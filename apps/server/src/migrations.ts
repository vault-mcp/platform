import pg from "pg";

export type PostgresMigration = {
  id: string;
  description: string;
  sql: string;
};

export type PostgresMigrationResult = {
  applied: PostgresMigration[];
  alreadyApplied: string[];
  pending: string[];
};

const MIGRATION_LOCK_ID = 742516391;

export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  {
    id: "0001_initial_vault_mcp_schema",
    description: "Create the initial Vault MCP tables, indexes, and multi-vault columns.",
    sql: `
      create table if not exists vault_index_meta (
        key text primary key,
        value jsonb not null
      );

      create table if not exists vault_documents (
        id text not null,
        tenant_id text not null default 'default',
        vault_id text not null default 'default',
        installation_id text not null default 'local',
        title text not null,
        text text not null,
        url text not null,
        metadata jsonb not null,
        search_vector tsvector generated always as (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(metadata->>'path', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(text, '')), 'C')
        ) stored,
        primary key (tenant_id, vault_id, id)
      );

      alter table vault_documents add column if not exists tenant_id text not null default 'default';
      alter table vault_documents add column if not exists vault_id text not null default 'default';
      alter table vault_documents add column if not exists installation_id text not null default 'local';
      alter table vault_documents drop constraint if exists vault_documents_pkey;
      alter table vault_documents add primary key (tenant_id, vault_id, id);

      create index if not exists vault_documents_search_idx on vault_documents using gin(search_vector);
      create index if not exists vault_documents_path_idx on vault_documents ((metadata->>'path'));
      create index if not exists vault_documents_vault_idx on vault_documents (tenant_id, vault_id);

      create table if not exists oauth_token_uses (
        jti text not null,
        kind text not null,
        expires_at timestamptz not null,
        used_at timestamptz not null default now(),
        primary key (jti, kind)
      );

      create index if not exists oauth_token_uses_expires_idx on oauth_token_uses (expires_at);

      create table if not exists oauth_clients (
        client_id text primary key,
        redirect_uris jsonb not null,
        client_name text not null,
        scope text not null,
        created_at timestamptz not null
      );

      create table if not exists vault_sync_manifests (
        tenant_id text not null,
        vault_id text not null,
        manifest jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (tenant_id, vault_id)
      );

      create table if not exists write_proposals (
        id text primary key,
        tenant_id text not null,
        vault_id text not null,
        proposal jsonb not null,
        status text not null,
        updated_at timestamptz not null
      );

      create index if not exists write_proposals_vault_idx on write_proposals (tenant_id, vault_id, status);
    `,
  },
];

export async function runPostgresMigrations(pool: pg.Pool): Promise<PostgresMigrationResult> {
  const client = await pool.connect();
  const applied: PostgresMigration[] = [];

  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      create table if not exists vault_mcp_schema_migrations (
        id text primary key,
        description text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const existing = await client.query<{ id: string }>("select id from vault_mcp_schema_migrations order by id");
    const alreadyApplied = existing.rows.map((row) => row.id);
    const alreadyAppliedSet = new Set(alreadyApplied);

    for (const migration of POSTGRES_MIGRATIONS) {
      if (alreadyAppliedSet.has(migration.id)) {
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into vault_mcp_schema_migrations (id, description, applied_at)
           values ($1, $2, now())`,
          [migration.id, migration.description],
        );
        await client.query("commit");
        applied.push(migration);
        alreadyAppliedSet.add(migration.id);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    const pending = POSTGRES_MIGRATIONS
      .filter((migration) => !alreadyAppliedSet.has(migration.id))
      .map((migration) => migration.id);

    return {
      applied,
      alreadyApplied,
      pending,
    };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

export async function getPostgresMigrationIds(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ id: string }>(`
    select id
    from vault_mcp_schema_migrations
    order by id
  `);
  return result.rows.map((row) => row.id);
}
