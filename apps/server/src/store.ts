import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { IndexStats, SearchResponse, SyncPayload, VaultDocument, VaultIndex } from "@vault-mcp/vault-core";
import { fetchDocument, searchDocuments } from "@vault-mcp/vault-core";

export type IndexHealth = {
  document_count: number;
  generated_at: string | null;
  stats: IndexStats | null;
};

export interface IndexStore {
  load?(): Promise<void>;
  close?(): Promise<void>;
  replace(payload: SyncPayload): Promise<void>;
  health(): IndexHealth | Promise<IndexHealth>;
  search(query: string, limit?: number, scope?: string): SearchResponse | Promise<SearchResponse>;
  fetch(id: string): VaultDocument | null | Promise<VaultDocument | null>;
}

export class JsonIndexStore implements IndexStore {
  private documents: VaultDocument[] = [];
  private generatedAt: string | null = null;
  private stats: IndexStats | null = null;

  constructor(private readonly indexFile: string) {}

  async load(): Promise<void> {
    try {
      const json = await fs.readFile(this.indexFile, "utf8");
      const parsed = JSON.parse(json) as Partial<VaultIndex>;
      this.documents = Array.isArray(parsed.documents) ? parsed.documents : [];
      this.generatedAt = typeof parsed.generated_at === "string" ? parsed.generated_at : null;
      this.stats = parsed.stats ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async replace(payload: SyncPayload): Promise<void> {
    this.documents = payload.documents;
    this.generatedAt = payload.generated_at ?? new Date().toISOString();
    this.stats = payload.stats ?? null;
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }

  health() {
    return {
      document_count: this.documents.length,
      generated_at: this.generatedAt,
      stats: this.stats,
    };
  }

  search(query: string, limit?: number, scope?: string) {
    return searchDocuments(this.documents, query, limit, scope);
  }

  fetch(id: string) {
    return fetchDocument(this.documents, id);
  }

  private snapshot(): VaultIndex {
    return {
      generated_at: this.generatedAt ?? new Date().toISOString(),
      vault_root: "synced",
      documents: this.documents,
      stats: this.stats ?? {
        scanned_markdown: 0,
        allowed_documents: this.documents.length,
        denied_markdown: 0,
        denied_by_rule: {},
      },
    };
  }
}

export class PostgresIndexStore implements IndexStore {
  private readonly pool: pg.Pool;
  private generatedAt: string | null = null;
  private stats: IndexStats | null = null;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async load(): Promise<void> {
    await this.pool.query(`
      create table if not exists vault_index_meta (
        key text primary key,
        value jsonb not null
      );

      create table if not exists vault_documents (
        id text primary key,
        title text not null,
        text text not null,
        url text not null,
        metadata jsonb not null,
        search_vector tsvector generated always as (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(metadata->>'path', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(text, '')), 'C')
        ) stored
      );

      create index if not exists vault_documents_search_idx on vault_documents using gin(search_vector);
      create index if not exists vault_documents_path_idx on vault_documents ((metadata->>'path'));
    `);

    const meta = await this.pool.query<{ key: string; value: unknown }>("select key, value from vault_index_meta");
    for (const row of meta.rows) {
      if (row.key === "generated_at" && typeof row.value === "string") {
        this.generatedAt = row.value;
      }
      if (row.key === "stats") {
        this.stats = row.value as IndexStats;
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async replace(payload: SyncPayload): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from vault_documents");
      for (const document of payload.documents) {
        await client.query(
          "insert into vault_documents (id, title, text, url, metadata) values ($1, $2, $3, $4, $5::jsonb)",
          [document.id, document.title, document.text, document.url, JSON.stringify(document.metadata)],
        );
      }

      this.generatedAt = payload.generated_at ?? new Date().toISOString();
      this.stats = payload.stats ?? null;
      await client.query(
        `insert into vault_index_meta (key, value) values
          ('generated_at', $1::jsonb),
          ('stats', $2::jsonb)
        on conflict (key) do update set value = excluded.value`,
        [JSON.stringify(this.generatedAt), JSON.stringify(this.stats)],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async health(): Promise<IndexHealth> {
    const count = await this.pool.query<{ count: string }>("select count(*)::text as count from vault_documents");
    return {
      document_count: Number(count.rows[0]?.count ?? 0),
      generated_at: this.generatedAt,
      stats: this.stats,
    };
  }

  async search(query: string, limit = 10, scope?: string): Promise<SearchResponse> {
    const normalizedLimit = Math.max(1, Math.min(limit, 25));
    const rows = await this.pool.query<{
      id: string;
      title: string;
      text: string;
      url: string;
      metadata: VaultDocument["metadata"];
    }>(
      `select id, title, text, url, metadata
       from vault_documents
       where search_vector @@ plainto_tsquery('english', $1)
       and ($3::text is null or metadata->>'path' like $3 || '%')
       order by ts_rank(search_vector, plainto_tsquery('english', $1)) desc, metadata->>'path' asc
       limit $2`,
      [query, normalizedLimit, scope ?? null],
    );

    return {
      results: rows.rows.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        text_snippet: row.text.replace(/\s+/g, " ").slice(0, 280),
        metadata: row.metadata,
      })),
    };
  }

  async fetch(id: string): Promise<VaultDocument | null> {
    const row = await this.pool.query<{
      id: string;
      title: string;
      text: string;
      url: string;
      metadata: VaultDocument["metadata"];
    }>("select id, title, text, url, metadata from vault_documents where id = $1", [id]);

    if (!row.rows[0]) {
      return null;
    }

    return row.rows[0];
  }
}
