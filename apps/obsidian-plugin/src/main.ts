import {
  analyzeWriteProposalWithAdapter,
  applyWriteProposalWithAdapter,
  buildDiffPreview,
} from "./write-helpers";
import {
  describeCaughtError,
  describeHttpFailure,
  normalizeServerBaseUrl,
  pluginConfigurationChecklist,
  pluginSafetyDisclosure,
  summarizeSyncResponse,
  summarizeServerStatus,
} from "./plugin-helpers";
import type { PluginServerHealthSnapshot, PluginServerStatusSummary, PluginVaultStatusSnapshot } from "./plugin-helpers";
import type {
  LocalApplyResult,
  ProposalSafetyAnalysis,
} from "./write-helpers";
import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
} from "obsidian";
import type { IndexMode, SyncPayload, VaultDocument, WriteMode, WriteProposal, WriteProposalStatus } from "@vault-mcp/core";

type VaultMcpPluginSettings = {
  serverUrl: string;
  syncToken: string;
  tenantId: string;
  vaultId: string;
  installationId: string;
  indexMode: IndexMode;
  writeMode: WriteMode;
  includePrefixes: string[];
  excludePrefixes: string[];
  manualAllowPaths: string[];
  manualAllowPrefixes: string[];
  syncIntervalMinutes: number;
  writeAuditFolder: string;
};

type SyncHistoryEntry = {
  type: "preview" | "sync" | "approval" | "server-check" | "proposal-check" | "proposal-update" | "error";
  message: string;
  createdAt: string;
  scanned?: number;
  indexed?: number;
  denied?: number;
  reviewRequired?: number;
  redacted?: number;
};

type VaultMcpPluginData = Partial<VaultMcpPluginSettings> & {
  syncHistory?: SyncHistoryEntry[];
};

type SyncSummary = {
  scanned: number;
  indexed: number;
  serverIndexed: number | null;
  denied: number;
  reviewRequired: number;
  redacted: number;
  generatedAt: string | null;
  serverGeneratedAt: string | null;
  lastSuccessMessage: string | null;
  lastError: string | null;
};

type ServerCheckState = PluginServerStatusSummary & {
  checkedAt: string;
};

type IndexDecision = "allow" | "deny" | "review";

type IndexDecisionResult = {
  decision: IndexDecision;
  reason: string;
  matchedRule: string;
};

type IndexPreviewItem = {
  path: string;
  title: string;
  tags: string[];
  status: string | null;
  decision: IndexDecision;
  reason: string;
  matchedRule: string;
  size: number;
  updatedAt: string;
  redactionCount: number;
};

type IndexPreview = {
  generatedAt: string;
  scanned: number;
  allowed: number;
  denied: number;
  reviewRequired: number;
  redacted: number;
  items: IndexPreviewItem[];
};

const DEFAULT_SETTINGS: VaultMcpPluginSettings = {
  serverUrl: "https://vault-mcp-connector.vercel.app",
  syncToken: "",
  tenantId: "default",
  vaultId: "default",
  installationId: "obsidian-plugin-local",
  indexMode: "rules_plus_approvals",
  writeMode: "review_required",
  includePrefixes: ["00 System/Task Hub.md", "20 Projects/", "40 Reference/"],
  excludePrefixes: ["00 System/Credentials/", "02 Daily/", "Daily Notes/", "50 Areas/Finance/", "50 Areas/Identity/", "50 Areas/Legal/", "90 Archive/"],
  manualAllowPaths: [],
  manualAllowPrefixes: [],
  syncIntervalMinutes: 0,
  writeAuditFolder: "00 System/Vault MCP Write Audit",
};

const DEFAULT_SUMMARY: SyncSummary = {
  scanned: 0,
  indexed: 0,
  serverIndexed: null,
  denied: 0,
  reviewRequired: 0,
  redacted: 0,
  generatedAt: null,
  serverGeneratedAt: null,
  lastSuccessMessage: null,
  lastError: null,
};

export default class VaultMcpPlugin extends Plugin {
  settings: VaultMcpPluginSettings = DEFAULT_SETTINGS;
  summary: SyncSummary = DEFAULT_SUMMARY;
  serverCheck: ServerCheckState | null = null;
  indexPreview: IndexPreview | null = null;
  writeProposals: WriteProposal[] = [];
  syncHistory: SyncHistoryEntry[] = [];

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new VaultMcpSettingTab(this.app, this));

    this.addRibbonIcon("network", "Vault MCP", () => {
      new VaultMcpDashboardModal(this.app, this).open();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => new VaultMcpDashboardModal(this.app, this).open(),
    });

    this.addCommand({
      id: "preview-index",
      name: "Preview index decisions",
      callback: () => {
        void this.openIndexPreview();
      },
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync approved vault context now",
      callback: () => {
        void this.syncNow();
      },
    });

    this.addCommand({
      id: "check-server-connection",
      name: "Check server connection",
      callback: () => {
        void this.checkServerConnection();
      },
    });

    this.addCommand({
      id: "check-write-proposals",
      name: "Check pending write proposals",
      callback: () => {
        void this.checkWriteProposals();
      },
    });
  }

  async loadSettings() {
    const saved = await this.loadData() as VaultMcpPluginData | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      includePrefixes: saved?.includePrefixes ?? DEFAULT_SETTINGS.includePrefixes,
      excludePrefixes: saved?.excludePrefixes ?? DEFAULT_SETTINGS.excludePrefixes,
      manualAllowPaths: saved?.manualAllowPaths ?? DEFAULT_SETTINGS.manualAllowPaths,
      manualAllowPrefixes: saved?.manualAllowPrefixes ?? DEFAULT_SETTINGS.manualAllowPrefixes,
    };
    this.syncHistory = saved?.syncHistory?.slice(0, 20) ?? [];
  }

  async saveSettings() {
    await this.saveData({
      ...this.settings,
      syncHistory: this.syncHistory.slice(0, 20),
    });
  }

  async syncNow() {
    if (!this.settings.syncToken.trim()) {
      const message = "Sync token is required. Add the server admin sync token in Vault MCP settings before syncing.";
      this.summary = { ...this.summary, lastError: message };
      await this.addHistory({ type: "error", message });
      new Notice(`Vault MCP: ${message}`);
      return;
    }

    try {
      const payload = await this.buildSyncPayload();
      const response = await requestUrl({
        url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/sync`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.syncToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(describeHttpFailure("sync", response.status, response.text));
      }

      const syncResult = summarizeSyncResponse(payload, response.text);
      this.summary = {
        scanned: payload.stats?.scanned_markdown ?? 0,
        indexed: payload.documents.length,
        serverIndexed: syncResult.serverDocumentCount,
        denied: payload.stats?.denied_markdown ?? 0,
        reviewRequired: payload.stats?.review_required_markdown ?? 0,
        redacted: payload.stats?.redacted_documents ?? 0,
        generatedAt: payload.generated_at ?? null,
        serverGeneratedAt: syncResult.serverGeneratedAt,
        lastSuccessMessage: syncResult.message,
        lastError: null,
      };
      this.indexPreview = null;
      await this.addHistory({
        type: "sync",
        message: syncResult.message,
        scanned: this.summary.scanned,
        indexed: this.summary.indexed,
        denied: this.summary.denied,
        reviewRequired: this.summary.reviewRequired,
        redacted: this.summary.redacted,
      });
      new Notice(`Vault MCP sync complete. ${syncResult.message}`);
    } catch (error) {
      const message = describeCaughtError("sync", error);
      this.summary = { ...this.summary, lastError: message };
      await this.addHistory({ type: "error", message: `Sync failed: ${message}` });
      new Notice(`Vault MCP sync failed: ${message}`);
    }
  }

  async checkServerConnection() {
    try {
      const healthResponse = await requestUrl({
        url: `${this.serverBaseUrl()}/healthz`,
        method: "GET",
      });
      if (healthResponse.status < 200 || healthResponse.status >= 300) {
        throw new Error(describeHttpFailure("server check", healthResponse.status, healthResponse.text));
      }

      const health = parseJsonResponse<PluginServerHealthSnapshot>(healthResponse.text, "server health");
      let vaultStatus: PluginVaultStatusSnapshot | null = null;
      if (this.settings.syncToken.trim()) {
        const vaultResponse = await requestUrl({
          url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/status`,
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.settings.syncToken}`,
          },
        });
        if (vaultResponse.status < 200 || vaultResponse.status >= 300) {
          throw new Error(describeHttpFailure("vault status check", vaultResponse.status, vaultResponse.text));
        }
        vaultStatus = parseJsonResponse<PluginVaultStatusSnapshot>(vaultResponse.text, "vault status");
      }

      const checkedAt = new Date().toISOString();
      this.serverCheck = {
        ...summarizeServerStatus(health, vaultStatus, Boolean(this.settings.syncToken.trim())),
        checkedAt,
      };
      this.summary = { ...this.summary, lastError: null };
      await this.addHistory({ type: "server-check", message: this.serverCheck.message });
      new VaultMcpServerStatusModal(this.app, this.serverCheck).open();
    } catch (error) {
      const message = describeCaughtError("server check", error);
      this.serverCheck = {
        status: "blocked",
        title: "Server check failed",
        message,
        facts: [],
        checkedAt: new Date().toISOString(),
      };
      this.summary = { ...this.summary, lastError: message };
      await this.addHistory({ type: "error", message: `Server check failed: ${message}` });
      new Notice(`Vault MCP server check failed: ${message}`);
    }
  }

  async openIndexPreview() {
    try {
      const preview = await this.buildIndexPreview();
      this.indexPreview = preview;
      this.summary = {
        scanned: preview.scanned,
        indexed: this.summary.indexed,
        serverIndexed: this.summary.serverIndexed,
        denied: preview.denied,
        reviewRequired: preview.reviewRequired,
        redacted: preview.redacted,
        generatedAt: preview.generatedAt,
        serverGeneratedAt: this.summary.serverGeneratedAt,
        lastSuccessMessage: this.summary.lastSuccessMessage,
        lastError: null,
      };
      await this.addHistory({
        type: "preview",
        message: `Previewed ${preview.scanned} note${preview.scanned === 1 ? "" : "s"}.`,
        scanned: preview.scanned,
        denied: preview.denied,
        reviewRequired: preview.reviewRequired,
        redacted: preview.redacted,
      });
      new VaultMcpIndexPreviewModal(this.app, this, preview).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.summary = { ...this.summary, lastError: message };
      await this.addHistory({ type: "error", message: `Preview failed: ${message}` });
      new Notice(`Vault MCP preview failed: ${message}`);
    }
  }

  async openReviewQueue() {
    try {
      const preview = this.indexPreview ?? await this.buildIndexPreview();
      this.indexPreview = preview;
      new VaultMcpReviewQueueModal(this.app, this, preview).open();
    } catch (error) {
      new Notice(`Vault MCP review queue failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async checkWriteProposals() {
    if (!this.settings.syncToken.trim()) {
      const message = "Sync token is required. Add the server admin sync token in Vault MCP settings before checking write proposals.";
      await this.addHistory({ type: "error", message });
      new Notice(`Vault MCP: ${message}`);
      return;
    }

    try {
      const proposals = await this.fetchWriteProposals();
      this.writeProposals = proposals;
      await this.addHistory({ type: "proposal-check", message: `Checked write proposals: ${proposals.length} found.` });
      new VaultMcpWriteProposalsModal(this.app, this, proposals).open();
    } catch (error) {
      const message = describeCaughtError("proposal check", error);
      await this.addHistory({ type: "error", message: `Proposal check failed: ${message}` });
      new Notice(`Vault MCP proposal check failed: ${message}`);
    }
  }

  async updateWriteProposalStatus(proposalId: string, status: Extract<WriteProposalStatus, "approved" | "rejected" | "conflict">) {
    if (!this.settings.syncToken.trim()) {
      const message = "Sync token is required. Add the server admin sync token in Vault MCP settings before updating write proposals.";
      await this.addHistory({ type: "error", message });
      new Notice(`Vault MCP: ${message}`);
      return;
    }

    const message = status === "approved"
      ? "Approved in Obsidian plugin. Local apply is not implemented yet."
      : status === "conflict"
        ? "Marked conflict in Obsidian plugin after local safety analysis."
        : "Rejected in Obsidian plugin.";
    try {
      const response = await requestUrl({
        url: `${this.serverBaseUrl()}/admin/write-proposals/${encodeURIComponent(proposalId)}`,
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.settings.syncToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          actor: `obsidian-plugin:${this.settings.installationId}`,
          message,
        }),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(describeHttpFailure("proposal update", response.status, response.text));
      }
      await this.addHistory({ type: "proposal-update", message: `Marked proposal ${proposalId} ${status}.` });
      new Notice(`Vault MCP proposal marked ${status}.`);
      const proposals = await this.fetchWriteProposals();
      this.writeProposals = proposals;
      new VaultMcpWriteProposalsModal(this.app, this, proposals).open();
    } catch (error) {
      const message = describeCaughtError("proposal update", error);
      await this.addHistory({ type: "error", message: `Proposal update failed: ${message}` });
      new Notice(`Vault MCP proposal update failed: ${message}`);
    }
  }

  async applyWriteProposal(proposal: WriteProposal) {
    if (!this.settings.syncToken.trim()) {
      const message = "Sync token is required. Add the server admin sync token in Vault MCP settings before applying write proposals.";
      await this.addHistory({ type: "error", message });
      new Notice(`Vault MCP: ${message}`);
      return;
    }

    try {
      const result = await this.applyWriteProposalLocally(proposal);
      await this.patchWriteProposalStatus(
        proposal.id,
        "applied",
        `Applied locally in Obsidian plugin. Backup: ${result.backupPath}. Audit: ${result.auditPath}. New hash: ${result.newHash}.`,
      );
      await this.addHistory({ type: "proposal-update", message: `Applied proposal ${proposal.id} locally.` });
      new Notice(`Vault MCP proposal applied locally. Backup: ${result.backupPath}`);
      const proposals = await this.fetchWriteProposals();
      this.writeProposals = proposals;
      new VaultMcpWriteProposalsModal(this.app, this, proposals).open();
    } catch (error) {
      const message = describeCaughtError("proposal apply", error);
      await this.addHistory({ type: "error", message: `Proposal apply failed: ${message}` });
      new Notice(`Vault MCP proposal apply failed: ${message}`);
    }
  }

  async approveManualPath(path: string) {
    if (!this.settings.manualAllowPaths.includes(path)) {
      this.settings.manualAllowPaths = [...this.settings.manualAllowPaths, path].sort();
    }
    this.indexPreview = null;
    await this.addHistory({ type: "approval", message: `Approved exact path: ${path}` });
    await this.saveSettings();
    new Notice(`Vault MCP approved exact path: ${path}`);
  }

  async approveManualPrefix(prefix: string) {
    if (!this.settings.manualAllowPrefixes.includes(prefix)) {
      this.settings.manualAllowPrefixes = [...this.settings.manualAllowPrefixes, prefix].sort();
    }
    this.indexPreview = null;
    await this.addHistory({ type: "approval", message: `Approved prefix: ${prefix}` });
    await this.saveSettings();
    new Notice(`Vault MCP approved prefix: ${prefix}`);
  }

  private async buildIndexPreview(): Promise<IndexPreview> {
    const files = this.app.vault.getMarkdownFiles();
    const generatedAt = new Date().toISOString();
    const items: IndexPreviewItem[] = [];
    let allowed = 0;
    let denied = 0;
    let reviewRequired = 0;
    let redacted = 0;

    for (const file of files) {
      const markdown = await this.app.vault.cachedRead(file);
      const parsed = parseNote(markdown, file);
      const policy = this.evaluateIndexDecision(file.path, parsed.tags, parsed.status);
      const redaction = redactSensitiveContent(markdown);
      if (redaction.count > 0) {
        redacted += 1;
      }
      if (policy.decision === "allow") {
        allowed += 1;
      } else if (policy.decision === "review") {
        reviewRequired += 1;
      } else {
        denied += 1;
      }
      items.push({
        path: file.path,
        title: parsed.title,
        tags: parsed.tags,
        status: parsed.status,
        decision: policy.decision,
        reason: policy.reason,
        matchedRule: policy.matchedRule,
        size: markdown.length,
        updatedAt: new Date(file.stat.mtime).toISOString(),
        redactionCount: redaction.count,
      });
    }

    return {
      generatedAt,
      scanned: files.length,
      allowed,
      denied,
      reviewRequired,
      redacted,
      items: items.sort((a, b) => decisionSort(a.decision) - decisionSort(b.decision) || a.path.localeCompare(b.path)),
    };
  }

  private async fetchWriteProposals(): Promise<WriteProposal[]> {
    const response = await requestUrl({
      url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/write-proposals`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.settings.syncToken}`,
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(describeHttpFailure("proposal check", response.status, response.text));
    }
    const parsed = JSON.parse(response.text) as { proposals?: WriteProposal[] };
    return parsed.proposals ?? [];
  }

  async analyzeWriteProposal(proposal: WriteProposal): Promise<ProposalSafetyAnalysis> {
    return analyzeWriteProposalWithAdapter(proposal, this.writeApplyAdapter());
  }

  private async applyWriteProposalLocally(proposal: WriteProposal): Promise<LocalApplyResult> {
    return applyWriteProposalWithAdapter(proposal, this.writeApplyAdapter());
  }

  private writeApplyAdapter() {
    return {
      writeAuditFolder: this.settings.writeAuditFolder,
      getFile: (path: string) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
      },
      readFile: (file: TFile) => this.app.vault.cachedRead(file),
      createFile: async (path: string, content: string) => {
        await this.app.vault.create(path, content);
      },
      processFile: async (file: TFile, updater: (content: string) => string) => {
        await this.app.vault.process(file, updater);
      },
      processFrontmatter: async (file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
        await this.app.fileManager.processFrontMatter(file, updater);
      },
      renameFile: (file: TFile, newPath: string) => this.app.fileManager.renameFile(file, newPath),
      ensureFolder: (folder: string) => this.ensureFolder(folder),
    };
  }

  private async ensureFolder(folder: string) {
    if (!folder) {
      return;
    }
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async buildSyncPayload(): Promise<SyncPayload> {
    const files = this.app.vault.getMarkdownFiles();
    const generatedAt = new Date().toISOString();
    const documents: VaultDocument[] = [];
    const deniedByRule: Record<string, number> = {};
    const reviewedByRule: Record<string, number> = {};
    const redactionsByPattern: Record<string, number> = {};
    let denied = 0;
    let reviewRequired = 0;
    let redactedDocuments = 0;

    for (const file of files) {
      const markdown = await this.app.vault.cachedRead(file);
      const parsed = parseNote(markdown, file);
      const decision = this.evaluateIndexDecision(file.path, parsed.tags, parsed.status);

      if (decision.decision === "deny") {
        denied += 1;
        deniedByRule[decision.matchedRule] = (deniedByRule[decision.matchedRule] ?? 0) + 1;
        continue;
      }
      if (decision.decision === "review") {
        reviewRequired += 1;
        reviewedByRule[decision.matchedRule] = (reviewedByRule[decision.matchedRule] ?? 0) + 1;
        continue;
      }

      const redacted = redactSensitiveContent(markdown);
      if (redacted.count > 0) {
        redactedDocuments += 1;
        for (const [name, count] of Object.entries(redacted.byPattern)) {
          redactionsByPattern[name] = (redactionsByPattern[name] ?? 0) + count;
        }
      }

      const contentHash = await sha256Hex(redacted.text);
      const chunks = chunkMarkdown(redacted.text);
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const id = (await sha256Hex(`${this.settings.vaultId}:${file.path}:${chunk.heading ?? "note"}:${chunkIndex}`)).slice(0, 24);
        documents.push({
          id,
          tenant_id: this.settings.tenantId,
          vault_id: this.settings.vaultId,
          installation_id: this.settings.installationId,
          title: chunk.heading ? `${parsed.title} - ${chunk.heading}` : parsed.title,
          text: chunk.text,
          url: `${this.serverBaseUrl()}/notes/${encodeURIComponent(id)}`,
          obsidian_uri: obsidianUri(this.app.vault.getName(), file.path),
          metadata: {
            tenant_id: this.settings.tenantId,
            vault_id: this.settings.vaultId,
            installation_id: this.settings.installationId,
            path: file.path,
            heading: chunk.heading,
            note_title: parsed.title,
            chunk_index: chunkIndex,
            tags: parsed.tags,
            status: parsed.status,
            updated_at: new Date(file.stat.mtime).toISOString(),
            content_hash: contentHash,
            obsidian_uri: obsidianUri(this.app.vault.getName(), file.path),
            source_policy: {
              allowed: true,
              reason: decision.reason,
              matched_rule: decision.matchedRule,
              policy_version: "vault-mcp-plugin-policy-v1",
              index_mode: this.settings.indexMode,
            },
          },
        });
      }
    }

    return {
      tenant_id: this.settings.tenantId,
      vault_id: this.settings.vaultId,
      installation_id: this.settings.installationId,
      vault_name: this.app.vault.getName(),
      policy_version: "vault-mcp-plugin-policy-v1",
      index_mode: this.settings.indexMode,
      generated_at: generatedAt,
      manifest: {
        tenant_id: this.settings.tenantId,
        vault_id: this.settings.vaultId,
        installation_id: this.settings.installationId,
        vault_name: this.app.vault.getName(),
        generated_at: generatedAt,
        policy_version: "vault-mcp-plugin-policy-v1",
        index_mode: this.settings.indexMode,
        policy_summary: {
          allowed_rules: this.settings.includePrefixes,
          denied_rules: this.settings.excludePrefixes,
          review_rules: this.settings.indexMode === "rules_plus_approvals" ? ["plugin-review-sensitive"] : [],
        },
      },
      documents,
      stats: {
        scanned_markdown: files.length,
        allowed_documents: documents.length,
        denied_markdown: denied,
        denied_by_rule: deniedByRule,
        review_required_markdown: reviewRequired,
        reviewed_by_rule: reviewedByRule,
        redacted_documents: redactedDocuments,
        redactions_by_pattern: redactionsByPattern,
      },
    };
  }

  private evaluateIndexDecision(path: string, tags: string[], status: string | null): IndexDecisionResult {
    if (this.settings.excludePrefixes.some((prefix) => path.startsWith(prefix))) {
      const prefix = this.settings.excludePrefixes.find((candidate) => path.startsWith(candidate)) ?? "exclude-prefix";
      return { decision: "deny", reason: `Denied by excluded prefix: ${prefix}`, matchedRule: `exclude:${prefix}` };
    }

    if (this.settings.manualAllowPaths.includes(path)) {
      return { decision: "allow", reason: "Allowed by exact manual approval.", matchedRule: `manual-path:${path}` };
    }
    const manualPrefix = this.settings.manualAllowPrefixes.find((candidate) => path.startsWith(candidate));
    if (manualPrefix) {
      return { decision: "allow", reason: `Allowed by manual approval prefix: ${manualPrefix}`, matchedRule: `manual-prefix:${manualPrefix}` };
    }

    const sensitive = tags.some((tag) => /sensitive|credential|finance|legal|identity|review/i.test(tag))
      || ["review", "needs-review", "sensitive"].includes((status ?? "").toLowerCase());
    if (sensitive) {
      return this.settings.indexMode === "rules_plus_approvals"
        ? { decision: "review", reason: "Sensitive tag or status requires manual approval.", matchedRule: "review:sensitive-metadata" }
        : { decision: "deny", reason: "Sensitive tag or status is denied by the current index mode.", matchedRule: "deny:sensitive-metadata" };
    }

    if (this.settings.indexMode === "manual_only") {
      if (this.settings.manualAllowPaths.includes(path)) {
        return { decision: "allow", reason: "Allowed by exact manual allow path.", matchedRule: `manual-path:${path}` };
      }
      const prefix = this.settings.manualAllowPrefixes.find((candidate) => path.startsWith(candidate));
      if (prefix) {
        return { decision: "allow", reason: `Allowed by manual allow prefix: ${prefix}`, matchedRule: `manual-prefix:${prefix}` };
      }
      return { decision: "deny", reason: "Denied because manual-only mode requires an explicit allow rule.", matchedRule: "manual-only:missing-allow" };
    }

    const includePrefix = this.settings.includePrefixes.find((prefix) => path === prefix || path.startsWith(prefix));
    if (includePrefix) {
      return { decision: "allow", reason: `Allowed by included prefix: ${includePrefix}`, matchedRule: `include:${includePrefix}` };
    }
    return { decision: "deny", reason: "Denied because no include rule matched.", matchedRule: "include:no-match" };
  }

  private serverBaseUrl(): string {
    return normalizeServerBaseUrl(this.settings.serverUrl);
  }

  private async addHistory(entry: Omit<SyncHistoryEntry, "createdAt">) {
    this.syncHistory = [{ ...entry, createdAt: new Date().toISOString() }, ...this.syncHistory].slice(0, 20);
    await this.saveSettings();
  }

  private async patchWriteProposalStatus(proposalId: string, status: WriteProposalStatus, message: string) {
    const response = await requestUrl({
      url: `${this.serverBaseUrl()}/admin/write-proposals/${encodeURIComponent(proposalId)}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.settings.syncToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
        actor: `obsidian-plugin:${this.settings.installationId}`,
        message,
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(describeHttpFailure("proposal update", response.status, response.text));
    }
  }
}

class VaultMcpDashboardModal extends Modal {
  constructor(app: App, private readonly plugin: VaultMcpPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Vault MCP" });
    addSafetyDisclosure(contentEl, this.plugin.settings);
    addConfigurationChecklist(contentEl, this.plugin.settings);
    addServerCheckSection(contentEl, this.plugin.serverCheck);
    const grid = contentEl.createDiv({ cls: "vault-mcp-dashboard" });
    addStat(grid, "Server", this.plugin.settings.serverUrl);
    addStat(grid, "Vault id", this.plugin.settings.vaultId);
    addStat(grid, "Index mode", this.plugin.settings.indexMode);
    addStat(grid, "Write mode", this.plugin.settings.writeMode);
    addStat(grid, "Last local chunks", String(this.plugin.summary.indexed));
    if (this.plugin.summary.serverIndexed !== null) {
      addStat(grid, "Server indexed chunks", String(this.plugin.summary.serverIndexed));
    }
    addStat(grid, "Review queue", String(this.plugin.summary.reviewRequired));
    if (this.plugin.indexPreview) {
      addStat(grid, "Preview allowed notes", String(this.plugin.indexPreview.allowed));
    }
    addStat(grid, "Last generated", this.plugin.summary.generatedAt ?? "Never");
    if (this.plugin.summary.serverGeneratedAt) {
      addStat(grid, "Server generated", this.plugin.summary.serverGeneratedAt);
    }
    if (this.plugin.summary.lastSuccessMessage) {
      addSyncSummarySection(contentEl, this.plugin.summary.lastSuccessMessage);
    }
    if (this.plugin.summary.lastError) {
      addStat(grid, "Last error", this.plugin.summary.lastError);
      addTroubleshootingHint(contentEl, this.plugin.summary.lastError);
    }
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Check connection")
        .setCta()
        .onClick(() => void this.plugin.checkServerConnection()));
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Preview index")
        .setCta()
        .onClick(() => void this.plugin.openIndexPreview()))
      .addButton((button) => button
        .setButtonText("Review queue")
        .onClick(() => void this.plugin.openReviewQueue()));
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Sync now")
        .onClick(() => void this.plugin.syncNow()))
      .addButton((button) => button
        .setButtonText("Review write proposals")
        .onClick(() => void this.plugin.checkWriteProposals()));
    addHistorySection(contentEl, this.plugin.syncHistory);
  }
}

class VaultMcpServerStatusModal extends Modal {
  constructor(app: App, private readonly check: ServerCheckState) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Vault MCP connection" });
    addServerCheckSection(contentEl, this.check);
  }
}

class VaultMcpIndexPreviewModal extends Modal {
  constructor(app: App, private readonly plugin: VaultMcpPlugin, private readonly preview: IndexPreview) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Vault MCP index preview" });
    contentEl.createEl("p", {
      cls: "vault-mcp-muted",
      text: "This is a dry run. It shows what the plugin would sync, deny, or hold for review before any data is sent.",
    });
    const grid = contentEl.createDiv({ cls: "vault-mcp-dashboard vault-mcp-dashboard--compact" });
    addStat(grid, "Scanned notes", String(this.preview.scanned));
    addStat(grid, "Allowed", String(this.preview.allowed));
    addStat(grid, "Needs review", String(this.preview.reviewRequired));
    addStat(grid, "Denied", String(this.preview.denied));
    addStat(grid, "Would redact", String(this.preview.redacted));
    addStat(grid, "Generated", this.preview.generatedAt);

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Open review queue")
        .onClick(() => void this.plugin.openReviewQueue()))
      .addButton((button) => button
        .setButtonText("Sync allowed notes")
        .setCta()
        .onClick(() => void this.plugin.syncNow()));

    addReviewSection(contentEl, this.plugin, this.preview.items.filter((item) => item.decision === "review"));
    addPreviewSection(contentEl, "Allowed", this.preview.items.filter((item) => item.decision === "allow"), false);
    if (this.plugin.settings.indexMode === "manual_only") {
      addManualApprovalSection(contentEl, this.plugin, this.preview.items.filter((item) => item.matchedRule === "manual-only:missing-allow"));
    }
    addPreviewSection(contentEl, "Denied", this.preview.items.filter((item) => item.decision === "deny"), false);
  }
}

class VaultMcpReviewQueueModal extends Modal {
  constructor(app: App, private readonly plugin: VaultMcpPlugin, private readonly preview: IndexPreview) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const queue = this.preview.items.filter((item) => item.decision === "review");
    contentEl.empty();
    contentEl.createEl("h2", { text: "Vault MCP review queue" });
    contentEl.createEl("p", {
      cls: "vault-mcp-muted",
      text: "These notes matched sensitive metadata and will not sync until you intentionally add them to manual allow paths or prefixes in settings.",
    });
    addStat(contentEl, "Queued notes", String(queue.length));

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Refresh preview")
        .onClick(() => {
          this.close();
          void this.plugin.openIndexPreview();
        }))
      .addButton((button) => button
        .setButtonText("Open settings")
        .onClick(() => {
          this.close();
          openPluginSettings(this.app, this.plugin);
        }));

    addReviewSection(contentEl, this.plugin, queue);
  }
}

class VaultMcpWriteProposalsModal extends Modal {
  constructor(app: App, private readonly plugin: VaultMcpPlugin, private readonly proposals: WriteProposal[]) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const pendingCount = this.proposals.filter((proposal) => proposal.status === "pending").length;
    contentEl.createEl("h2", { text: "Vault MCP write proposals" });
    contentEl.createEl("p", {
      cls: "vault-mcp-muted",
      text: "These are remote write requests stored on the server. The plugin checks local file hashes before approval and only applies supported approved proposals after creating backup and audit notes.",
    });
    const grid = contentEl.createDiv({ cls: "vault-mcp-dashboard vault-mcp-dashboard--compact" });
    addStat(grid, "Total proposals", String(this.proposals.length));
    addStat(grid, "Pending", String(pendingCount));
    addStat(grid, "Vault id", this.plugin.settings.vaultId);
    addStat(grid, "Write mode", this.plugin.settings.writeMode);

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Refresh")
        .setCta()
        .onClick(() => {
          this.close();
          void this.plugin.checkWriteProposals();
        }));

    if (this.proposals.length === 0) {
      contentEl.createEl("p", { cls: "vault-mcp-muted", text: "No write proposals found for this vault." });
      return;
    }

    const list = contentEl.createDiv({ cls: "vault-mcp-proposal-list" });
    list.createEl("p", { cls: "vault-mcp-muted", text: "Analyzing local files and proposal hashes..." });
    void this.renderProposalCards(list);
  }

  private async renderProposalCards(list: HTMLElement) {
    list.empty();
    for (const proposal of this.proposals) {
      const analysis = await this.plugin.analyzeWriteProposal(proposal);
      addWriteProposalCard(list, this.plugin, this, proposal, analysis);
    }
  }
}

class VaultMcpSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultMcpPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    addSafetyDisclosure(containerEl, this.plugin.settings);
    addConfigurationChecklist(containerEl, this.plugin.settings);
    addServerCheckSection(containerEl, this.plugin.serverCheck);

    new Setting(containerEl)
      .setName("Connection preflight")
      .setDesc("Checks /healthz and, when a sync token is saved, verifies this vault's admin status endpoint.")
      .addButton((button) => button
        .setButtonText("Check connection")
        .setCta()
        .onClick(() => void this.plugin.checkServerConnection()));

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("Base URL of the Vault MCP server.")
      .addText((text) => text
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async (value) => {
          this.plugin.settings.serverUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Sync token")
      .setDesc("Admin sync token used by the plugin to register and sync this vault.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.syncToken)
          .onChange(async (value) => {
            this.plugin.settings.syncToken = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Vault id")
      .setDesc("Stable id used by the server when multiple vaults are connected.")
      .addText((text) => text
        .setValue(this.plugin.settings.vaultId)
        .onChange(async (value) => {
          this.plugin.settings.vaultId = value.trim() || "default";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Index mode")
      .addDropdown((dropdown) => dropdown
        .addOption("rules_plus_approvals", "Rules plus approvals")
        .addOption("manual_only", "Manual only")
        .addOption("rules_only", "Rules only")
        .setValue(this.plugin.settings.indexMode)
        .onChange(async (value) => {
          this.plugin.settings.indexMode = value as IndexMode;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Write mode")
      .setDesc("Review required is the safe default. Direct apply remains reserved until explicitly reviewed.")
      .addDropdown((dropdown) => dropdown
        .addOption("review_required", "Review required")
        .addOption("direct_apply", "Direct apply")
        .setValue(this.plugin.settings.writeMode)
        .onChange(async (value) => {
          this.plugin.settings.writeMode = value as WriteMode;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Index rules").setHeading();
    addListSetting(containerEl, "Include prefixes", "One vault-relative prefix per line.", this.plugin.settings.includePrefixes, async (values) => {
      this.plugin.settings.includePrefixes = values;
      await this.plugin.saveSettings();
    });
    addListSetting(containerEl, "Exclude prefixes", "One vault-relative prefix per line. Exclusions win before includes.", this.plugin.settings.excludePrefixes, async (values) => {
      this.plugin.settings.excludePrefixes = values;
      await this.plugin.saveSettings();
    });
    addListSetting(containerEl, "Manual allow paths", "Exact paths used by manual-only mode.", this.plugin.settings.manualAllowPaths, async (values) => {
      this.plugin.settings.manualAllowPaths = values;
      await this.plugin.saveSettings();
    });
    addListSetting(containerEl, "Manual allow prefixes", "Prefixes used by manual-only mode.", this.plugin.settings.manualAllowPrefixes, async (values) => {
      this.plugin.settings.manualAllowPrefixes = values;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl).setName("Write safety").setHeading();
    new Setting(containerEl)
      .setName("Write audit folder")
      .setDesc("Vault-relative folder where local write backups and audit notes are created before any proposal is applied.")
      .addText((text) => text
        .setValue(this.plugin.settings.writeAuditFolder)
        .onChange(async (value) => {
          this.plugin.settings.writeAuditFolder = value.trim() || DEFAULT_SETTINGS.writeAuditFolder;
          await this.plugin.saveSettings();
        }));
  }
}

function addStat(parent: HTMLElement, label: string, value: string) {
  const stat = parent.createDiv({ cls: "vault-mcp-dashboard__stat" });
  stat.createDiv({ cls: "vault-mcp-dashboard__label", text: label });
  stat.createDiv({ cls: "vault-mcp-dashboard__value", text: value });
}

function addSyncSummarySection(parent: HTMLElement, message: string) {
  const box = parent.createDiv({ cls: "vault-mcp-sync-summary" });
  box.createDiv({ cls: "vault-mcp-safety__title", text: "Last sync summary" });
  box.createDiv({ cls: "vault-mcp-safety__message", text: message });
}

function addSafetyDisclosure(parent: HTMLElement, settings: VaultMcpPluginSettings) {
  const disclosure = pluginSafetyDisclosure(settings);
  const box = parent.createDiv({ cls: "vault-mcp-disclosure" });
  box.createDiv({ cls: "vault-mcp-disclosure__title", text: disclosure.title });
  box.createDiv({ cls: "vault-mcp-disclosure__summary", text: disclosure.summary });
  const list = box.createEl("ul", { cls: "vault-mcp-disclosure__list" });
  for (const point of disclosure.points) {
    list.createEl("li", { text: point });
  }
}

function addConfigurationChecklist(parent: HTMLElement, settings: VaultMcpPluginSettings) {
  const checklist = pluginConfigurationChecklist(settings);
  const box = parent.createDiv({ cls: "vault-mcp-checklist" });
  const heading = checklist.readyToSync ? "Configuration ready" : "Configuration needs attention";
  box.createDiv({ cls: "vault-mcp-checklist__title", text: heading });
  box.createDiv({
    cls: "vault-mcp-checklist__summary",
    text: checklist.readyToSync
      ? "Preview and sync are available with the current settings."
      : "Resolve blocked items before syncing. Warnings are allowed, but should be reviewed.",
  });
  const list = box.createDiv({ cls: "vault-mcp-checklist__items" });
  for (const item of checklist.items) {
    const row = list.createDiv({ cls: `vault-mcp-checklist__item vault-mcp-checklist__item--${item.status}` });
    row.createDiv({ cls: "vault-mcp-checklist__status", text: item.status });
    const body = row.createDiv({ cls: "vault-mcp-checklist__body" });
    body.createDiv({ cls: "vault-mcp-checklist__label", text: item.label });
    body.createDiv({ cls: "vault-mcp-checklist__message", text: item.message });
  }
}

function addServerCheckSection(parent: HTMLElement, check: ServerCheckState | null) {
  const box = parent.createDiv({ cls: `vault-mcp-server-check vault-mcp-server-check--${check?.status ?? "unknown"}` });
  box.createDiv({ cls: "vault-mcp-server-check__title", text: check?.title ?? "Connection not checked" });
  box.createDiv({
    cls: "vault-mcp-server-check__message",
    text: check?.message ?? "Run Check connection before syncing to confirm the server URL, storage, sync token, and configured vault status.",
  });
  if (check) {
    box.createDiv({ cls: "vault-mcp-server-check__checked", text: `Checked: ${formatDate(check.checkedAt)}` });
  }
  if (check?.facts.length) {
    const list = box.createEl("ul", { cls: "vault-mcp-server-check__facts" });
    for (const fact of check.facts) {
      list.createEl("li", { text: fact });
    }
  }
}

function addTroubleshootingHint(parent: HTMLElement, message: string) {
  const lower = message.toLowerCase();
  const hints: string[] = [];
  if (lower.includes("sync token") || lower.includes("authorized")) {
    hints.push("Open Vault MCP settings and confirm the sync token matches the server admin token.");
  }
  if (lower.includes("server url") || lower.includes("endpoint")) {
    hints.push("Use only the base server URL, such as https://vault-mcp-connector.vercel.app. Do not include /mcp or /admin.");
  }
  if (lower.includes("could not reach") || lower.includes("server failed")) {
    hints.push("Check /healthz in a browser and review server logs if the health check fails.");
  }
  if (hints.length === 0) {
    return;
  }
  const details = parent.createEl("details", { cls: "vault-mcp-preview-section vault-mcp-troubleshooting" });
  details.open = true;
  details.createEl("summary", { text: "Suggested fix" });
  const list = details.createEl("ul");
  for (const hint of hints) {
    list.createEl("li", { text: hint });
  }
}

function addPreviewSection(parent: HTMLElement, title: string, items: IndexPreviewItem[], startOpen: boolean) {
  const details = parent.createEl("details", { cls: "vault-mcp-preview-section" });
  details.open = startOpen;
  details.createEl("summary", { text: `${title} (${items.length})` });
  if (items.length === 0) {
    details.createEl("p", { cls: "vault-mcp-muted", text: "No notes in this group." });
    return;
  }

  const list = details.createDiv({ cls: "vault-mcp-preview-list" });
  for (const item of items) {
    const card = list.createDiv({ cls: "vault-mcp-preview-card" });
    const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
    header.createDiv({ cls: "vault-mcp-preview-card__title", text: item.title });
    header.createDiv({ cls: `vault-mcp-chip vault-mcp-chip--${item.decision}`, text: item.decision });
    card.createDiv({ cls: "vault-mcp-preview-card__path", text: item.path });
    const meta = card.createDiv({ cls: "vault-mcp-preview-card__meta" });
    meta.createSpan({ text: `rule: ${item.matchedRule}` });
    meta.createSpan({ text: `updated: ${formatDate(item.updatedAt)}` });
    meta.createSpan({ text: `${item.size.toLocaleString()} chars` });
    if (item.status) {
      meta.createSpan({ text: `status: ${item.status}` });
    }
    if (item.redactionCount > 0) {
      meta.createSpan({ text: `redactions: ${item.redactionCount}` });
    }
    if (item.tags.length > 0) {
      const tags = card.createDiv({ cls: "vault-mcp-preview-card__tags" });
      for (const tag of item.tags.slice(0, 12)) {
        tags.createSpan({ cls: "vault-mcp-tag", text: `#${tag}` });
      }
      if (item.tags.length > 12) {
        tags.createSpan({ cls: "vault-mcp-tag", text: `+${item.tags.length - 12}` });
      }
    }
    card.createDiv({ cls: "vault-mcp-preview-card__reason", text: item.reason });
  }
}

function addReviewSection(parent: HTMLElement, plugin: VaultMcpPlugin, items: IndexPreviewItem[]) {
  const details = parent.createEl("details", { cls: "vault-mcp-preview-section" });
  details.open = true;
  details.createEl("summary", { text: `Needs review (${items.length})` });
  if (items.length === 0) {
    details.createEl("p", { cls: "vault-mcp-muted", text: "No notes are waiting for review." });
    return;
  }

  const list = details.createDiv({ cls: "vault-mcp-preview-list" });
  for (const item of items) {
    const card = list.createDiv({ cls: "vault-mcp-preview-card vault-mcp-preview-card--review" });
    const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
    header.createDiv({ cls: "vault-mcp-preview-card__title", text: item.title });
    header.createDiv({ cls: "vault-mcp-chip vault-mcp-chip--review", text: "review" });
    card.createDiv({ cls: "vault-mcp-preview-card__path", text: item.path });
    const meta = card.createDiv({ cls: "vault-mcp-preview-card__meta" });
    meta.createSpan({ text: `rule: ${item.matchedRule}` });
    meta.createSpan({ text: `updated: ${formatDate(item.updatedAt)}` });
    if (item.status) {
      meta.createSpan({ text: `status: ${item.status}` });
    }
    if (item.tags.length > 0) {
      const tags = card.createDiv({ cls: "vault-mcp-preview-card__tags" });
      for (const tag of item.tags.slice(0, 12)) {
        tags.createSpan({ cls: "vault-mcp-tag", text: `#${tag}` });
      }
      if (item.tags.length > 12) {
        tags.createSpan({ cls: "vault-mcp-tag", text: `+${item.tags.length - 12}` });
      }
    }
    card.createDiv({ cls: "vault-mcp-preview-card__reason", text: item.reason });
    const actions = card.createDiv({ cls: "vault-mcp-preview-card__actions" });
    new Setting(actions)
      .addButton((button) => button
        .setButtonText("Approve exact path")
        .setCta()
        .onClick(() => void plugin.approveManualPath(item.path)))
      .addButton((button) => button
        .setButtonText(`Approve folder: ${parentPrefix(item.path)}`)
        .onClick(() => void plugin.approveManualPrefix(parentPrefix(item.path))));
  }
}

function addManualApprovalSection(parent: HTMLElement, plugin: VaultMcpPlugin, items: IndexPreviewItem[]) {
  const details = parent.createEl("details", { cls: "vault-mcp-preview-section" });
  details.open = items.length > 0;
  details.createEl("summary", { text: `Manual approval candidates (${items.length})` });
  details.createEl("p", {
    cls: "vault-mcp-muted",
    text: "These notes are denied only because manual-only mode requires an explicit path or prefix approval.",
  });
  if (items.length === 0) {
    return;
  }
  const list = details.createDiv({ cls: "vault-mcp-preview-list" });
  for (const item of items) {
    const card = list.createDiv({ cls: "vault-mcp-preview-card" });
    const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
    header.createDiv({ cls: "vault-mcp-preview-card__title", text: item.title });
    header.createDiv({ cls: "vault-mcp-chip vault-mcp-chip--deny", text: "manual" });
    card.createDiv({ cls: "vault-mcp-preview-card__path", text: item.path });
    card.createDiv({ cls: "vault-mcp-preview-card__reason", text: item.reason });
    const actions = card.createDiv({ cls: "vault-mcp-preview-card__actions" });
    new Setting(actions)
      .addButton((button) => button
        .setButtonText("Approve exact path")
        .setCta()
        .onClick(() => void plugin.approveManualPath(item.path)))
      .addButton((button) => button
        .setButtonText(`Approve folder: ${parentPrefix(item.path)}`)
        .onClick(() => void plugin.approveManualPrefix(parentPrefix(item.path))));
  }
}

function addHistorySection(parent: HTMLElement, history: SyncHistoryEntry[]) {
  const details = parent.createEl("details", { cls: "vault-mcp-preview-section vault-mcp-history" });
  details.open = history.length > 0;
  details.createEl("summary", { text: `Recent activity (${history.length})` });
  if (history.length === 0) {
    details.createEl("p", { cls: "vault-mcp-muted", text: "No plugin activity has been recorded yet." });
    return;
  }
  const list = details.createDiv({ cls: "vault-mcp-history-list" });
  for (const entry of history.slice(0, 8)) {
    const row = list.createDiv({ cls: "vault-mcp-history-row" });
    row.createDiv({ cls: `vault-mcp-chip vault-mcp-chip--${historyTone(entry.type)}`, text: entry.type });
    const body = row.createDiv({ cls: "vault-mcp-history-row__body" });
    body.createDiv({ cls: "vault-mcp-history-row__message", text: entry.message });
    const metrics = [
      entry.scanned === undefined ? null : `scanned ${entry.scanned}`,
      entry.indexed === undefined ? null : `indexed ${entry.indexed}`,
      entry.denied === undefined ? null : `denied ${entry.denied}`,
      entry.reviewRequired === undefined ? null : `review ${entry.reviewRequired}`,
      entry.redacted === undefined ? null : `redacted ${entry.redacted}`,
    ].filter((value): value is string => Boolean(value));
    body.createDiv({ cls: "vault-mcp-history-row__meta", text: [formatDate(entry.createdAt), ...metrics].join(" · ") });
  }
}

function addWriteProposalCard(parent: HTMLElement, plugin: VaultMcpPlugin, modal: Modal, proposal: WriteProposal, analysis: ProposalSafetyAnalysis) {
  const card = parent.createDiv({ cls: "vault-mcp-proposal-card" });
  const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
  header.createDiv({ cls: "vault-mcp-preview-card__title", text: proposal.target_path });
  header.createDiv({ cls: `vault-mcp-chip vault-mcp-chip--${proposalStatusTone(proposal.status)}`, text: proposal.status });

  const meta = card.createDiv({ cls: "vault-mcp-preview-card__meta" });
  meta.createSpan({ text: `operation: ${proposal.operation}` });
  meta.createSpan({ text: `requester: ${proposal.requester}` });
  meta.createSpan({ text: `updated: ${formatDate(proposal.updated_at)}` });
  if (proposal.base_content_hash) {
    meta.createSpan({ text: `base: ${proposal.base_content_hash.slice(0, 16)}` });
  }
  if (analysis.currentHash) {
    meta.createSpan({ text: `local: ${analysis.currentHash.slice(0, 16)}` });
  }

  card.createDiv({
    cls: "vault-mcp-preview-card__reason",
    text: `Proposal id: ${proposal.id}`,
  });

  addSafetySummary(card, analysis);

  if (analysis.diffPreview) {
    addCodePreview(card, "Local diff preview", analysis.diffPreview);
  } else if (proposal.proposed_patch) {
    addCodePreview(card, "Proposed patch", proposal.proposed_patch);
  } else if (proposal.proposed_content) {
    addCodePreview(card, "Proposed content", proposal.proposed_content);
  }

  addAuditTrail(card, proposal);

  if (proposal.status === "pending" || proposal.status === "approved") {
    const actions = card.createDiv({ cls: "vault-mcp-preview-card__actions" });
    const setting = new Setting(actions);
    if (proposal.status === "pending" && analysis.canApplyInFuture) {
      setting.addButton((button) => button
        .setButtonText("Approve")
        .setCta()
        .onClick(() => {
          modal.close();
          void plugin.updateWriteProposalStatus(proposal.id, "approved");
        }));
    }
    if (proposal.status === "approved" && analysis.canApplyInFuture) {
      setting.addButton((button) => button
        .setButtonText("Apply locally")
        .setCta()
        .onClick(() => {
          modal.close();
          void plugin.applyWriteProposal(proposal);
        }));
    } else if (analysis.status === "conflict" || analysis.status === "missing-target" || analysis.status === "existing-target") {
      setting.addButton((button) => button
        .setButtonText("Mark conflict")
        .setCta()
        .onClick(() => {
          modal.close();
          void plugin.updateWriteProposalStatus(proposal.id, "conflict");
        }));
    }
    if (proposal.status === "pending") {
      setting.addButton((button) => button
        .setButtonText("Reject")
        .onClick(() => {
          modal.close();
          void plugin.updateWriteProposalStatus(proposal.id, "rejected");
        }));
    }
  }
}

function addSafetySummary(parent: HTMLElement, analysis: ProposalSafetyAnalysis) {
  const box = parent.createDiv({ cls: `vault-mcp-safety vault-mcp-safety--${analysis.status}` });
  box.createDiv({ cls: "vault-mcp-safety__title", text: safetyTitle(analysis.status) });
  box.createDiv({ cls: "vault-mcp-safety__message", text: analysis.message });
  const facts = box.createDiv({ cls: "vault-mcp-preview-card__meta" });
  facts.createSpan({ text: `target: ${analysis.targetExists ? "exists" : "missing"}` });
  facts.createSpan({ text: `base hash: ${analysis.baseHashMatches === null ? "not supplied" : analysis.baseHashMatches ? "matches" : "mismatch"}` });
  facts.createSpan({ text: `future apply: ${analysis.canApplyInFuture ? "possible" : "blocked"}` });
}

function addCodePreview(parent: HTMLElement, label: string, value: string) {
  const section = parent.createDiv({ cls: "vault-mcp-code-preview" });
  section.createDiv({ cls: "vault-mcp-dashboard__label", text: label });
  section.createEl("pre", { text: truncateMiddle(value, 4000) });
}

function addAuditTrail(parent: HTMLElement, proposal: WriteProposal) {
  const details = parent.createEl("details", { cls: "vault-mcp-proposal-audit" });
  details.createEl("summary", { text: `Audit trail (${proposal.audit.length})` });
  const list = details.createDiv({ cls: "vault-mcp-history-list" });
  for (const entry of proposal.audit) {
    const row = list.createDiv({ cls: "vault-mcp-history-row" });
    row.createDiv({ cls: `vault-mcp-chip vault-mcp-chip--${proposalStatusTone(entry.status)}`, text: entry.status });
    const body = row.createDiv({ cls: "vault-mcp-history-row__body" });
    body.createDiv({ cls: "vault-mcp-history-row__message", text: entry.message });
    body.createDiv({ cls: "vault-mcp-history-row__meta", text: `${formatDate(entry.created_at)} · ${entry.actor}` });
  }
}

function addListSetting(containerEl: HTMLElement, name: string, desc: string, value: string[], onSave: (values: string[]) => Promise<void>) {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addTextArea((text) => {
      text.inputEl.rows = 5;
      text.setValue(value.join("\n"))
        .onChange(async (next) => {
          await onSave(next.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        });
    });
}

function openPluginSettings(app: App, plugin: VaultMcpPlugin) {
  const setting = (app as App & { setting: { open(): void; openTabById(id: string): void } }).setting;
  setting.open();
  setting.openTabById(plugin.manifest.id);
}

function parentPrefix(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(0, index + 1);
}

function historyTone(type: SyncHistoryEntry["type"]): "allow" | "deny" | "review" {
  if (type === "error") {
    return "deny";
  }
  if (type === "approval" || type === "sync" || type === "proposal-update") {
    return "allow";
  }
  return "review";
}

function proposalStatusTone(status: WriteProposalStatus): "allow" | "deny" | "review" {
  if (status === "approved" || status === "applied") {
    return "allow";
  }
  if (status === "rejected" || status === "conflict" || status === "failed") {
    return "deny";
  }
  return "review";
}

function safetyTitle(status: ProposalSafetyAnalysis["status"]): string {
  if (status === "ready") {
    return "Local safety check ready";
  }
  if (status === "conflict") {
    return "Hash conflict";
  }
  if (status === "missing-target") {
    return "Missing local target";
  }
  if (status === "existing-target") {
    return "Target already exists";
  }
  return "Unsupported apply path";
}

function parseJsonResponse<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Could not parse ${label} response as JSON.`);
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const half = Math.floor((maxLength - 40) / 2);
  return `${value.slice(0, half)}\n\n... truncated ${value.length - maxLength} characters ...\n\n${value.slice(-half)}`;
}

function decisionSort(decision: IndexDecision): number {
  if (decision === "review") {
    return 0;
  }
  if (decision === "allow") {
    return 1;
  }
  return 2;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function parseNote(markdown: string, file: TFile): { title: string; tags: string[]; status: string | null } {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, "");
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.basename;
  const tags = new Set<string>();
  const frontmatter = markdown.match(/^---([\s\S]*?)---/);
  const status = frontmatter?.[1].match(/^status:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() ?? null;
  const tagBlock = frontmatter?.[1].match(/^tags:\s*([\s\S]*?)(?:\n\w|$)/m)?.[1] ?? "";
  for (const match of tagBlock.matchAll(/-\s*#?([A-Za-z0-9/_-]+)/g)) {
    tags.add(match[1]);
  }
  for (const match of body.matchAll(/(?:^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]*)/g)) {
    tags.add(match[1]);
  }
  return { title, tags: [...tags].sort(), status };
}

function chunkMarkdown(markdown: string, maxChars = 4000): Array<{ heading: string | null; text: string }> {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, "").trim();
  const chunks: Array<{ heading: string | null; text: string }> = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && buffer.join("\n").length > 0) {
      chunks.push(...splitChunk(heading, buffer.join("\n"), maxChars));
      buffer = [];
    }
    if (match) {
      heading = match[2].trim();
    }
    buffer.push(line);
  }
  if (buffer.length > 0) {
    chunks.push(...splitChunk(heading, buffer.join("\n"), maxChars));
  }
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

function splitChunk(heading: string | null, text: string, maxChars: number): Array<{ heading: string | null; text: string }> {
  if (text.length <= maxChars) {
    return [{ heading, text: text.trim() }];
  }
  const chunks: Array<{ heading: string | null; text: string }> = [];
  for (let start = 0; start < text.length; start += maxChars) {
    chunks.push({ heading, text: text.slice(start, start + maxChars).trim() });
  }
  return chunks;
}

function redactSensitiveContent(markdown: string): { text: string; count: number; byPattern: Record<string, number> } {
  const patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
    { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
    { name: "env-secret", pattern: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY)\s*=\s*["']?[^"'\s]+["']?/gi },
    { name: "password-field", pattern: /\bpassword\s*[:=]\s*["']?[^"'\s]+["']?/gi },
  ];
  let text = markdown;
  const byPattern: Record<string, number> = {};
  for (const { name, pattern } of patterns) {
    text = text.replace(pattern, () => {
      byPattern[name] = (byPattern[name] ?? 0) + 1;
      return `[REDACTED:${name}]`;
    });
  }
  return { text, count: Object.values(byPattern).reduce((sum, count) => sum + count, 0), byPattern };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function obsidianUri(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}
