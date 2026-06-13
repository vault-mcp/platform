import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type {
  DebugSearchResponse,
  IndexStats,
  IndexStatusResponse,
  ListNotesOptions,
  ListNotesResponse,
  NoteSummary,
  SearchOptions,
  SearchResponse,
  SyncManifest,
  SyncPayload,
  VaultStatus,
  VaultDocument,
  VaultIndex,
  VaultSummary,
  WriteProposal,
  WriteProposalStatus,
} from "@vault-mcp/core";
import {
  activeProjects,
  debugSearch,
  DEFAULT_INSTALLATION_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_VAULT_ID,
  fetchDocument,
  fetchDocumentByPath,
  getIndexStatus,
  listNotes,
  recentNotes,
  searchDocuments,
  searchNotes,
  searchSections,
  searchVault,
} from "@vault-mcp/core";
import { getPostgresMigrationIds, runPostgresMigrations } from "./migrations.js";

export type IndexHealth = {
  document_count: number;
  vault_count: number;
  generated_at: string | null;
  last_sync_at: string | null;
  stats: IndexStats | null;
  storage: {
    kind: "json" | "postgres";
    ok: boolean;
    migrations?: string[];
    error?: string;
  };
};

export type StoredOAuthClient = {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  scope: string;
  createdAt: string;
};

export interface IndexStore {
  load?(): Promise<void>;
  close?(): Promise<void>;
  registerVault(manifest: SyncManifest): Promise<void>;
  deleteVault(vaultId: string): Promise<void>;
  replace(payload: SyncPayload): Promise<void>;
  health(): IndexHealth | Promise<IndexHealth>;
  search(query: string, limit?: number, scope?: string): SearchResponse | Promise<SearchResponse>;
  searchNotes(options: SearchOptions): SearchResponse | Promise<SearchResponse>;
  searchSections(options: SearchOptions): SearchResponse | Promise<SearchResponse>;
  searchVault(options: SearchOptions): SearchResponse | Promise<SearchResponse>;
  fetch(id: string, vaultId?: string): VaultDocument | null | Promise<VaultDocument | null>;
  fetchByPath(path: string, vaultId?: string): VaultDocument | null | Promise<VaultDocument | null>;
  listNotes(options: ListNotesOptions): ListNotesResponse | Promise<ListNotesResponse>;
  recentNotes(scope?: string, limit?: number, vaultId?: string): { notes: NoteSummary[] } | Promise<{ notes: NoteSummary[] }>;
  activeProjects(limit?: number, cursor?: string, vaultId?: string): ListNotesResponse | Promise<ListNotesResponse>;
  indexStatus(vaultId?: string): IndexStatusResponse | Promise<IndexStatusResponse>;
  debugSearch(query: string, scope?: string, vaultId?: string): DebugSearchResponse | Promise<DebugSearchResponse>;
  listVaults(): VaultSummary[] | Promise<VaultSummary[]>;
  vaultStatus(vaultId?: string): VaultStatus | Promise<VaultStatus>;
  createWriteProposal(proposal: WriteProposal): WriteProposal | Promise<WriteProposal>;
  listWriteProposals(vaultId?: string): WriteProposal[] | Promise<WriteProposal[]>;
  updateWriteProposalStatus(id: string, status: WriteProposalStatus, actor: string, message: string): WriteProposal | null | Promise<WriteProposal | null>;
  saveOAuthClient(client: StoredOAuthClient): void | Promise<void>;
  getOAuthClient(clientId: string): StoredOAuthClient | null | Promise<StoredOAuthClient | null>;
  consumeOAuthJti(jti: string, kind: "authorization_code" | "refresh_token", expiresAt: Date): boolean | Promise<boolean>;
}

export class JsonIndexStore implements IndexStore {
  private documents: VaultDocument[] = [];
  private generatedAt: string | null = null;
  private stats: IndexStats | null = null;
  private manifests = new Map<string, SyncPayload["manifest"]>();
  private writeProposals = new Map<string, WriteProposal>();
  private oauthClients = new Map<string, StoredOAuthClient>();
  private consumedOAuthJtis = new Map<string, number>();

  constructor(private readonly indexFile: string) {}

  async load(): Promise<void> {
    try {
      const json = await fs.readFile(this.indexFile, "utf8");
      const parsed = JSON.parse(json) as Partial<VaultIndex>;
      this.documents = Array.isArray(parsed.documents) ? parsed.documents : [];
      this.generatedAt = typeof parsed.generated_at === "string" ? parsed.generated_at : null;
      this.stats = parsed.stats ?? null;
      if (parsed.manifest?.vault_id) {
        this.manifests.set(parsed.manifest.vault_id, parsed.manifest);
      }
      for (const manifest of parsed.manifests ?? []) {
        this.manifests.set(manifest.vault_id, manifest);
      }
      for (const proposal of parsed.write_proposals ?? []) {
        this.writeProposals.set(proposal.id, proposal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async registerVault(manifest: SyncManifest): Promise<void> {
    this.manifests.set(manifest.vault_id, manifest);
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }

  async deleteVault(vaultId: string): Promise<void> {
    this.documents = this.documents.filter((document) => (document.vault_id ?? document.metadata.vault_id ?? DEFAULT_VAULT_ID) !== vaultId);
    this.manifests.delete(vaultId);
    for (const [id, proposal] of this.writeProposals.entries()) {
      if (proposal.vault_id === vaultId) {
        this.writeProposals.delete(id);
      }
    }
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }

  async replace(payload: SyncPayload): Promise<void> {
    const tenantId = payload.tenant_id ?? payload.manifest?.tenant_id ?? DEFAULT_TENANT_ID;
    const vaultId = payload.vault_id ?? payload.manifest?.vault_id ?? DEFAULT_VAULT_ID;
    const installationId = payload.installation_id ?? payload.manifest?.installation_id ?? DEFAULT_INSTALLATION_ID;
    const scopedDocuments = payload.documents.map((document) => withDocumentScope(document, tenantId, vaultId, installationId));
    this.documents = payload.vault_id || payload.manifest?.vault_id
      ? [
          ...this.documents.filter((document) => (document.tenant_id ?? document.metadata.tenant_id ?? DEFAULT_TENANT_ID) !== tenantId
            || (document.vault_id ?? document.metadata.vault_id ?? DEFAULT_VAULT_ID) !== vaultId),
          ...scopedDocuments,
        ]
      : scopedDocuments;
    this.generatedAt = payload.generated_at ?? new Date().toISOString();
    this.stats = payload.stats ?? null;
    if (payload.manifest) {
      this.manifests.set(vaultId, payload.manifest);
    }
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }

  health() {
    return {
      document_count: this.documents.length,
      vault_count: summarizeVaults(this.documents, this.manifests, this.generatedAt).length,
      generated_at: this.generatedAt,
      last_sync_at: this.generatedAt,
      stats: this.stats,
      storage: {
        kind: "json" as const,
        ok: true,
      },
    };
  }

  search(query: string, limit?: number, scope?: string) {
    return searchDocuments(this.documents, query, limit, scope);
  }

  searchNotes(options: SearchOptions) {
    return searchNotes(this.documents, options);
  }

  searchSections(options: SearchOptions) {
    return searchSections(this.documents, options);
  }

  searchVault(options: SearchOptions) {
    return searchVault(this.documents, options);
  }

  fetch(id: string, vaultId?: string) {
    return fetchDocument(this.documents, id, vaultId);
  }

  fetchByPath(notePath: string, vaultId?: string) {
    return fetchDocumentByPath(this.documents, notePath, vaultId);
  }

  listNotes(options: ListNotesOptions) {
    return listNotes(this.documents, options);
  }

  recentNotes(scope?: string, limit?: number, vaultId?: string) {
    return recentNotes(this.documents, scope, limit, vaultId);
  }

  activeProjects(limit?: number, cursor?: string, vaultId?: string) {
    return activeProjects(this.documents, limit, cursor, vaultId);
  }

  indexStatus(vaultId?: string) {
    return getIndexStatus(this.documents, this.stats, this.generatedAt, vaultId);
  }

  debugSearch(query: string, scope?: string, vaultId?: string) {
    return debugSearch(this.documents, query, scope, this.generatedAt, vaultId);
  }

  listVaults() {
    return summarizeVaults(this.documents, this.manifests, this.generatedAt);
  }

  vaultStatus(vaultId?: string): VaultStatus {
    const status = this.indexStatus(vaultId);
    const scopedDocuments = vaultId ? this.documents.filter((document) => (document.vault_id ?? document.metadata.vault_id) === vaultId) : this.documents;
    return {
      ...status,
      document_count: scopedDocuments.length,
      generated_at: this.generatedAt,
      stats: this.stats,
    };
  }

  async createWriteProposal(proposal: WriteProposal): Promise<WriteProposal> {
    this.writeProposals.set(proposal.id, proposal);
    await this.persist();
    return proposal;
  }

  listWriteProposals(vaultId?: string): WriteProposal[] {
    return [...this.writeProposals.values()]
      .filter((proposal) => !vaultId || proposal.vault_id === vaultId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateWriteProposalStatus(id: string, status: WriteProposalStatus, actor: string, message: string): Promise<WriteProposal | null> {
    const proposal = this.writeProposals.get(id);
    if (!proposal) {
      return null;
    }
    const now = new Date().toISOString();
    const updated = {
      ...proposal,
      status,
      updated_at: now,
      audit: [
        ...proposal.audit,
        {
          status,
          actor,
          message,
          created_at: now,
        },
      ],
    };
    this.writeProposals.set(id, updated);
    await this.persist();
    return updated;
  }

  saveOAuthClient(client: StoredOAuthClient): void {
    this.oauthClients.set(client.clientId, client);
  }

  getOAuthClient(clientId: string): StoredOAuthClient | null {
    return this.oauthClients.get(clientId) ?? null;
  }

  consumeOAuthJti(jti: string, kind: "authorization_code" | "refresh_token", expiresAt: Date): boolean {
    const now = Date.now();
    for (const [key, expires] of this.consumedOAuthJtis.entries()) {
      if (expires <= now) {
        this.consumedOAuthJtis.delete(key);
      }
    }

    const key = `${kind}:${jti}`;
    if (this.consumedOAuthJtis.has(key)) {
      return false;
    }

    this.consumedOAuthJtis.set(key, expiresAt.getTime());
    return true;
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
      manifest: [...this.manifests.values()][0],
      manifests: [...this.manifests.values()].filter((manifest): manifest is SyncManifest => Boolean(manifest)),
      write_proposals: [...this.writeProposals.values()],
    };
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
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
    await runPostgresMigrations(this.pool);

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

  async registerVault(manifest: SyncManifest): Promise<void> {
    await this.pool.query(
      `insert into vault_sync_manifests (tenant_id, vault_id, manifest, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (tenant_id, vault_id) do update set manifest = excluded.manifest, updated_at = now()`,
      [manifest.tenant_id, manifest.vault_id, JSON.stringify(manifest)],
    );
  }

  async deleteVault(vaultId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from vault_documents where vault_id = $1", [vaultId]);
      await client.query("delete from vault_sync_manifests where vault_id = $1", [vaultId]);
      await client.query("delete from write_proposals where vault_id = $1", [vaultId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async replace(payload: SyncPayload): Promise<void> {
    const client = await this.pool.connect();
    const tenantId = payload.tenant_id ?? payload.manifest?.tenant_id ?? DEFAULT_TENANT_ID;
    const vaultId = payload.vault_id ?? payload.manifest?.vault_id ?? DEFAULT_VAULT_ID;
    const installationId = payload.installation_id ?? payload.manifest?.installation_id ?? DEFAULT_INSTALLATION_ID;
    try {
      await client.query("begin");
      if (payload.vault_id || payload.manifest?.vault_id) {
        await client.query("delete from vault_documents where tenant_id = $1 and vault_id = $2", [tenantId, vaultId]);
      } else {
        await client.query("delete from vault_documents");
      }
      for (const document of payload.documents) {
        const scopedDocument = withDocumentScope(document, tenantId, vaultId, installationId);
        await client.query(
          "insert into vault_documents (id, tenant_id, vault_id, installation_id, title, text, url, metadata) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
          [scopedDocument.id, tenantId, vaultId, installationId, scopedDocument.title, scopedDocument.text, scopedDocument.url, JSON.stringify(scopedDocument.metadata)],
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
      if (payload.manifest) {
        await client.query(
          `insert into vault_sync_manifests (tenant_id, vault_id, manifest, updated_at)
           values ($1, $2, $3::jsonb, now())
           on conflict (tenant_id, vault_id) do update set manifest = excluded.manifest, updated_at = now()`,
          [tenantId, vaultId, JSON.stringify(payload.manifest)],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async health(): Promise<IndexHealth> {
    try {
      const [count, migrations, vaults] = await Promise.all([
        this.pool.query<{ count: string }>("select count(*)::text as count from vault_documents"),
        getPostgresMigrationIds(this.pool),
        this.listVaults(),
      ]);
      return {
        document_count: Number(count.rows[0]?.count ?? 0),
        vault_count: vaults.length,
        generated_at: this.generatedAt,
        last_sync_at: mostRecentSyncAt(vaults.map((vault) => vault.last_indexed_at), this.generatedAt),
        stats: this.stats,
        storage: {
          kind: "postgres",
          ok: true,
          migrations,
        },
      };
    } catch (error) {
      return {
        document_count: 0,
        vault_count: 0,
        generated_at: this.generatedAt,
        last_sync_at: this.generatedAt,
        stats: this.stats,
        storage: {
          kind: "postgres",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async search(query: string, limit = 10, scope?: string): Promise<SearchResponse> {
    return searchDocuments(await this.allDocuments(), query, limit, scope);
  }

  async fetch(id: string, vaultId?: string): Promise<VaultDocument | null> {
    const row = await this.pool.query<{
      id: string;
      tenant_id: string;
      vault_id: string;
      installation_id: string;
      title: string;
      text: string;
      url: string;
      metadata: VaultDocument["metadata"];
    }>(
      `select id, tenant_id, vault_id, installation_id, title, text, url, metadata
       from vault_documents
       where id = $1 and ($2::text is null or vault_id = $2)`,
      [id, vaultId ?? null],
    );

    if (!row.rows[0]) {
      return null;
    }

    return {
      ...row.rows[0],
      obsidian_uri: row.rows[0].metadata.obsidian_uri,
    };
  }

  async searchNotes(options: SearchOptions): Promise<SearchResponse> {
    return searchNotes(await this.allDocuments(), options);
  }

  async searchSections(options: SearchOptions): Promise<SearchResponse> {
    return searchSections(await this.allDocuments(), options);
  }

  async searchVault(options: SearchOptions): Promise<SearchResponse> {
    return searchVault(await this.allDocuments(), options);
  }

  async fetchByPath(notePath: string, vaultId?: string): Promise<VaultDocument | null> {
    return fetchDocumentByPath(await this.allDocuments(), notePath, vaultId);
  }

  async listNotes(options: ListNotesOptions): Promise<ListNotesResponse> {
    return listNotes(await this.allDocuments(), options);
  }

  async recentNotes(scope?: string, limit?: number, vaultId?: string): Promise<{ notes: NoteSummary[] }> {
    return recentNotes(await this.allDocuments(), scope, limit, vaultId);
  }

  async activeProjects(limit?: number, cursor?: string, vaultId?: string): Promise<ListNotesResponse> {
    return activeProjects(await this.allDocuments(), limit, cursor, vaultId);
  }

  async indexStatus(vaultId?: string): Promise<IndexStatusResponse> {
    return getIndexStatus(await this.allDocuments(), this.stats, this.generatedAt, vaultId);
  }

  async debugSearch(query: string, scope?: string, vaultId?: string): Promise<DebugSearchResponse> {
    return debugSearch(await this.allDocuments(), query, scope, this.generatedAt, vaultId);
  }

  async listVaults(): Promise<VaultSummary[]> {
    return summarizeVaults(await this.allDocuments(), await this.allManifests(), this.generatedAt);
  }

  async vaultStatus(vaultId?: string): Promise<VaultStatus> {
    const status = await this.indexStatus(vaultId);
    const documents = await this.allDocuments();
    const scopedDocuments = vaultId ? documents.filter((document) => (document.vault_id ?? document.metadata.vault_id) === vaultId) : documents;
    return {
      ...status,
      document_count: scopedDocuments.length,
      generated_at: this.generatedAt,
      stats: this.stats,
    };
  }

  async createWriteProposal(proposal: WriteProposal): Promise<WriteProposal> {
    await this.pool.query(
      `insert into write_proposals (id, tenant_id, vault_id, proposal, status, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (id) do update set proposal = excluded.proposal, status = excluded.status, updated_at = excluded.updated_at`,
      [proposal.id, proposal.tenant_id, proposal.vault_id, JSON.stringify(proposal), proposal.status, proposal.updated_at],
    );
    return proposal;
  }

  async listWriteProposals(vaultId?: string): Promise<WriteProposal[]> {
    const result = await this.pool.query<{ proposal: WriteProposal }>(
      `select proposal
       from write_proposals
       where ($1::text is null or vault_id = $1)
       order by updated_at desc`,
      [vaultId ?? null],
    );
    return result.rows.map((row) => row.proposal);
  }

  async updateWriteProposalStatus(id: string, status: WriteProposalStatus, actor: string, message: string): Promise<WriteProposal | null> {
    const existing = await this.pool.query<{ proposal: WriteProposal }>("select proposal from write_proposals where id = $1", [id]);
    const proposal = existing.rows[0]?.proposal;
    if (!proposal) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: WriteProposal = {
      ...proposal,
      status,
      updated_at: now,
      audit: [
        ...proposal.audit,
        { status, actor, message, created_at: now },
      ],
    };
    await this.createWriteProposal(updated);
    return updated;
  }

  async saveOAuthClient(client: StoredOAuthClient): Promise<void> {
    await this.pool.query(
      `insert into oauth_clients (client_id, redirect_uris, client_name, scope, created_at)
       values ($1, $2::jsonb, $3, $4, $5)
       on conflict (client_id) do update set
         redirect_uris = excluded.redirect_uris,
         client_name = excluded.client_name,
         scope = excluded.scope`,
      [client.clientId, JSON.stringify(client.redirectUris), client.clientName, client.scope, client.createdAt],
    );
  }

  async getOAuthClient(clientId: string): Promise<StoredOAuthClient | null> {
    const result = await this.pool.query<{
      client_id: string;
      redirect_uris: unknown;
      client_name: string;
      scope: string;
      created_at: Date;
    }>(
      "select client_id, redirect_uris, client_name, scope, created_at from oauth_clients where client_id = $1",
      [clientId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      clientId: row.client_id,
      redirectUris: Array.isArray(row.redirect_uris) ? row.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [],
      clientName: row.client_name,
      scope: row.scope,
      createdAt: row.created_at.toISOString(),
    };
  }

  async consumeOAuthJti(jti: string, kind: "authorization_code" | "refresh_token", expiresAt: Date): Promise<boolean> {
    await this.pool.query("delete from oauth_token_uses where expires_at < now()");
    const result = await this.pool.query(
      `insert into oauth_token_uses (jti, kind, expires_at)
       values ($1, $2, $3)
       on conflict do nothing`,
      [jti, kind, expiresAt.toISOString()],
    );
    return result.rowCount === 1;
  }

  private async allDocuments(): Promise<VaultDocument[]> {
    const rows = await this.pool.query<{
      id: string;
      tenant_id: string;
      vault_id: string;
      installation_id: string;
      title: string;
      text: string;
      url: string;
      metadata: VaultDocument["metadata"];
    }>(
      `select id, tenant_id, vault_id, installation_id, title, text, url, metadata
       from vault_documents
       order by metadata->>'path' asc, coalesce((metadata->>'chunk_index')::int, 0) asc, id asc`,
    );

    return rows.rows.map((row) => ({
      ...row,
      obsidian_uri: row.metadata.obsidian_uri,
    }));
  }

  private async allManifests(): Promise<Map<string, SyncPayload["manifest"]>> {
    const rows = await this.pool.query<{ vault_id: string; manifest: SyncPayload["manifest"] }>("select vault_id, manifest from vault_sync_manifests");
    return new Map(rows.rows.map((row) => [row.vault_id, row.manifest]));
  }
}

function withDocumentScope(document: VaultDocument, tenantId: string, vaultId: string, installationId: string): VaultDocument {
  return {
    ...document,
    tenant_id: document.tenant_id ?? tenantId,
    vault_id: document.vault_id ?? vaultId,
    installation_id: document.installation_id ?? installationId,
    metadata: {
      ...document.metadata,
      tenant_id: document.metadata.tenant_id ?? tenantId,
      vault_id: document.metadata.vault_id ?? vaultId,
      installation_id: document.metadata.installation_id ?? installationId,
    },
  };
}

function summarizeVaults(documents: VaultDocument[], manifests: Map<string, SyncPayload["manifest"]>, generatedAt: string | null): VaultSummary[] {
  const groups = new Map<string, VaultDocument[]>();
  for (const document of documents) {
    const tenantId = document.tenant_id ?? document.metadata.tenant_id ?? DEFAULT_TENANT_ID;
    const vaultId = document.vault_id ?? document.metadata.vault_id ?? DEFAULT_VAULT_ID;
    const key = `${tenantId}:${vaultId}`;
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }

  if (groups.size === 0 && manifests.size === 0) {
    return [];
  }

  const summaries = [...groups.entries()].map(([key, vaultDocuments]) => {
    const [tenantId, vaultId] = key.split(":");
    const manifest = manifests.get(vaultId);
    const first = vaultDocuments[0];
    return {
      tenant_id: tenantId || DEFAULT_TENANT_ID,
      vault_id: vaultId || DEFAULT_VAULT_ID,
      installation_id: manifest?.installation_id ?? first?.installation_id ?? first?.metadata.installation_id ?? null,
      vault_name: manifest?.vault_name ?? first?.metadata.vault_id ?? vaultId ?? DEFAULT_VAULT_ID,
      index_mode: manifest?.index_mode ?? first?.metadata.source_policy.index_mode ?? null,
      document_count: vaultDocuments.length,
      last_indexed_at: manifest?.generated_at ?? generatedAt,
    };
  });

  for (const manifest of manifests.values()) {
    if (!manifest || summaries.some((summary) => summary.vault_id === manifest.vault_id && summary.tenant_id === manifest.tenant_id)) {
      continue;
    }
    summaries.push({
      tenant_id: manifest.tenant_id,
      vault_id: manifest.vault_id,
      installation_id: manifest.installation_id,
      vault_name: manifest.vault_name,
      index_mode: manifest.index_mode,
      document_count: 0,
      last_indexed_at: manifest.generated_at,
    });
  }

  return summaries.sort((a, b) => a.vault_id.localeCompare(b.vault_id));
}

function mostRecentSyncAt(values: Array<string | null | undefined>, fallback: string | null): string | null {
  const valid = values
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(new Date(value).getTime()))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0] ?? fallback;
}
