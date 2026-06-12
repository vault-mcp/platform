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
import type { IndexMode, SyncPayload, VaultDocument, WriteMode } from "@vault-mcp/core";

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
};

type SyncSummary = {
  scanned: number;
  indexed: number;
  denied: number;
  reviewRequired: number;
  redacted: number;
  generatedAt: string | null;
  lastError: string | null;
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
};

const DEFAULT_SUMMARY: SyncSummary = {
  scanned: 0,
  indexed: 0,
  denied: 0,
  reviewRequired: 0,
  redacted: 0,
  generatedAt: null,
  lastError: null,
};

export default class VaultMcpPlugin extends Plugin {
  settings: VaultMcpPluginSettings = DEFAULT_SETTINGS;
  summary: SyncSummary = DEFAULT_SUMMARY;

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
      id: "sync-now",
      name: "Sync approved vault context now",
      callback: () => {
        void this.syncNow();
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
    const saved = await this.loadData() as Partial<VaultMcpPluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      includePrefixes: saved?.includePrefixes ?? DEFAULT_SETTINGS.includePrefixes,
      excludePrefixes: saved?.excludePrefixes ?? DEFAULT_SETTINGS.excludePrefixes,
      manualAllowPaths: saved?.manualAllowPaths ?? DEFAULT_SETTINGS.manualAllowPaths,
      manualAllowPrefixes: saved?.manualAllowPrefixes ?? DEFAULT_SETTINGS.manualAllowPrefixes,
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncNow() {
    if (!this.settings.syncToken.trim()) {
      new Notice("Vault MCP sync token is required.");
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
        throw new Error(`Sync failed with ${response.status}: ${response.text}`);
      }

      this.summary = {
        scanned: payload.stats?.scanned_markdown ?? 0,
        indexed: payload.documents.length,
        denied: payload.stats?.denied_markdown ?? 0,
        reviewRequired: payload.stats?.review_required_markdown ?? 0,
        redacted: payload.stats?.redacted_documents ?? 0,
        generatedAt: payload.generated_at ?? null,
        lastError: null,
      };
      new Notice(`Vault MCP synced ${payload.documents.length} approved document chunk${payload.documents.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.summary = { ...this.summary, lastError: message };
      new Notice(`Vault MCP sync failed: ${message}`);
    }
  }

  async checkWriteProposals() {
    if (!this.settings.syncToken.trim()) {
      new Notice("Vault MCP sync token is required.");
      return;
    }

    try {
      const response = await requestUrl({
        url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/write-proposals`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.settings.syncToken}`,
        },
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Request failed with ${response.status}: ${response.text}`);
      }
      const parsed = JSON.parse(response.text) as { proposals?: unknown[] };
      new Notice(`Vault MCP has ${parsed.proposals?.length ?? 0} write proposal${parsed.proposals?.length === 1 ? "" : "s"} pending or recorded.`);
    } catch (error) {
      new Notice(`Vault MCP proposal check failed: ${error instanceof Error ? error.message : String(error)}`);
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

      if (decision === "deny") {
        denied += 1;
        deniedByRule["plugin-policy"] = (deniedByRule["plugin-policy"] ?? 0) + 1;
        continue;
      }
      if (decision === "review") {
        reviewRequired += 1;
        reviewedByRule["plugin-review"] = (reviewedByRule["plugin-review"] ?? 0) + 1;
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
              reason: "Allowed by Obsidian plugin policy.",
              matched_rule: `plugin-${this.settings.indexMode}`,
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

  private evaluateIndexDecision(path: string, tags: string[], status: string | null): "allow" | "deny" | "review" {
    if (this.settings.excludePrefixes.some((prefix) => path.startsWith(prefix))) {
      return "deny";
    }

    const sensitive = tags.some((tag) => /sensitive|credential|finance|legal|identity|review/i.test(tag))
      || ["review", "needs-review", "sensitive"].includes((status ?? "").toLowerCase());
    if (sensitive) {
      return this.settings.indexMode === "rules_plus_approvals" ? "review" : "deny";
    }

    if (this.settings.indexMode === "manual_only") {
      return this.settings.manualAllowPaths.includes(path) || this.settings.manualAllowPrefixes.some((prefix) => path.startsWith(prefix))
        ? "allow"
        : "deny";
    }

    return this.settings.includePrefixes.some((prefix) => path === prefix || path.startsWith(prefix)) ? "allow" : "deny";
  }

  private serverBaseUrl(): string {
    return this.settings.serverUrl.replace(/\/$/, "");
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
    const grid = contentEl.createDiv({ cls: "vault-mcp-dashboard" });
    addStat(grid, "Server", this.plugin.settings.serverUrl);
    addStat(grid, "Vault id", this.plugin.settings.vaultId);
    addStat(grid, "Index mode", this.plugin.settings.indexMode);
    addStat(grid, "Write mode", this.plugin.settings.writeMode);
    addStat(grid, "Last indexed chunks", String(this.plugin.summary.indexed));
    addStat(grid, "Review queue", String(this.plugin.summary.reviewRequired));
    addStat(grid, "Last generated", this.plugin.summary.generatedAt ?? "Never");
    if (this.plugin.summary.lastError) {
      addStat(grid, "Last error", this.plugin.summary.lastError);
    }
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Sync now")
        .setCta()
        .onClick(() => void this.plugin.syncNow()))
      .addButton((button) => button
        .setButtonText("Check write proposals")
        .onClick(() => void this.plugin.checkWriteProposals()));
  }
}

class VaultMcpSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultMcpPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
      .setDesc("Write tools are not active yet; this reserves the future plugin behavior.")
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
  }
}

function addStat(parent: HTMLElement, label: string, value: string) {
  const stat = parent.createDiv({ cls: "vault-mcp-dashboard__stat" });
  stat.createDiv({ cls: "vault-mcp-dashboard__label", text: label });
  stat.createDiv({ cls: "vault-mcp-dashboard__value", text: value });
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
