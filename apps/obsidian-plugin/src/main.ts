import {
  analyzeWriteProposalWithAdapter,
  applyWriteProposalWithAdapter,
  buildDiffPreview,
} from "./write-helpers";
import {
  buildLocalClientConnectionBundle,
  buildLocalClientInstructions,
  buildLocalServerLaunchCommand,
  buildLocalServerSpawnConfig,
  describeCaughtError,
  describeHttpFailure,
  localServerPortCandidates,
  normalizeServerBaseUrl,
  parsePluginSetupBundle,
  pluginDataForPersistence,
  pluginConfigurationChecklist,
  pluginLocalServerStatus,
  pluginSafetyDisclosure,
  pluginSetupGuide,
  summarizeSyncResponse,
  summarizeServerStatus,
  validateLocalServerCompatibility,
} from "./plugin-helpers";
import type { PluginServerHealthSnapshot, PluginServerStatusSummary, PluginVaultStatusSnapshot } from "./plugin-helpers";
import type { LocalServerSpawnConfig } from "./plugin-helpers";
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
import type { IndexMode, LocalAccessRequest, LocalAgentToolDefinition, LocalFsAccessMode, LocalFsPolicy, LocalFsWriteOperation, SyncPayload, VaultDocument, WriteMode, WriteProposal, WriteProposalStatus } from "@vault-mcp/core";

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
  localServerModeEnabled: boolean;
  localServerPort: number;
  localServerKeepAlive: boolean;
  localServerDataDir: string;
  localServerMcpToken: string;
  localServerSyncToken: string;
  localServerCredentialsCreatedAt: string | null;
  localServerProjectDir: string;
  localServerCommand: string;
  localFsAccessMode: LocalFsAccessMode;
  localFsReadRoots: string[];
  localFsWriteRoots: string[];
  localFsWriteOperations: LocalFsWriteOperation[];
  localFsMaxReadBytes: number;
  localFsMaxSearchResults: number;
  localFsMaxSearchFiles: number;
  localFsAccessTtlMinutes: number;
  localFsRequireUserIntent: boolean;
  localFsUserIntentPhrase: string;
  hostedLocalBridgeEnabled: boolean;
  hostedLocalBridgePollSeconds: number;
};

type SyncHistoryEntry = {
  type: "preview" | "sync" | "approval" | "server-check" | "setup-import" | "proposal-check" | "proposal-update" | "local-server" | "hosted-bridge" | "error";
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

type LocalServerChildProcess = {
  pid?: number;
  kill(signal?: string): boolean;
  on(event: "error", listener: (error: Error) => void): LocalServerChildProcess;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): LocalServerChildProcess;
  unref?(): void;
};

type ChildProcessModule = {
  spawn(
    command: string,
    args: string[],
    options: {
      cwd: string;
      detached: boolean;
      shell: boolean;
      stdio: "ignore";
      env?: Record<string, string | undefined>;
    },
  ): LocalServerChildProcess;
};

type FsModule = {
  existsSync(path: string): boolean;
};

type NetSocket = {
  once(event: "connect" | "error", listener: () => void): NetSocket;
  setTimeout(timeout: number, listener: () => void): NetSocket;
  destroy(): void;
};

type NetModule = {
  createConnection(options: { host: string; port: number }): NetSocket;
};

type PathModule = {
  join(...segments: string[]): string;
};

type LocalPortSelection = {
  port: number;
  reused: boolean;
  health: PluginServerHealthSnapshot | null;
  message: string;
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
  localServerModeEnabled: false,
  localServerPort: 38791,
  localServerKeepAlive: false,
  localServerDataDir: "data/local-server",
  localServerMcpToken: "",
  localServerSyncToken: "",
  localServerCredentialsCreatedAt: null,
  localServerProjectDir: "",
  localServerCommand: "npm",
  localFsAccessMode: "off",
  localFsReadRoots: [],
  localFsWriteRoots: [],
  localFsWriteOperations: ["write_file"],
  localFsMaxReadBytes: 512 * 1024,
  localFsMaxSearchResults: 100,
  localFsMaxSearchFiles: 2000,
  localFsAccessTtlMinutes: 120,
  localFsRequireUserIntent: true,
  localFsUserIntentPhrase: "use local filesystem",
  hostedLocalBridgeEnabled: false,
  hostedLocalBridgePollSeconds: 1,
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
  localServerProcess: LocalServerChildProcess | null = null;
  localServerStartedAt: string | null = null;
  localServerHealth: PluginServerHealthSnapshot | null = null;
  hostedLocalBridgeTimer: number | null = null;
  hostedLocalBridgeBusy = false;
  hostedLocalBridgeConnectedAt: string | null = null;
  hostedLocalBridgeLastSeenAt: string | null = null;
  hostedLocalBridgeLastError: string | null = null;

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

    this.addCommand({
      id: "start-local-server",
      name: "Start local desktop server",
      callback: () => {
        void this.startLocalServer();
      },
    });

    this.addCommand({
      id: "stop-local-server",
      name: "Stop local desktop server",
      callback: () => {
        void this.stopLocalServer();
      },
    });

    this.addCommand({
      id: "refresh-local-filesystem-session",
      name: "Refresh local filesystem access session",
      callback: () => {
        void this.refreshLocalServerSession();
      },
    });

    this.addCommand({
      id: "start-hosted-local-bridge",
      name: "Enable hosted ChatGPT desktop bridge",
      callback: () => {
        void this.startHostedLocalBridge();
      },
    });

    this.addCommand({
      id: "stop-hosted-local-bridge",
      name: "Disable hosted ChatGPT desktop bridge",
      callback: () => {
        void this.stopHostedLocalBridge();
      },
    });

  }

  onunload() {
    this.clearHostedLocalBridgeTimer();
    this.settings.hostedLocalBridgeEnabled = false;
    this.hostedLocalBridgeConnectedAt = null;
    this.hostedLocalBridgeLastSeenAt = null;
    this.hostedLocalBridgeLastError = null;
    if (this.localServerProcess && !this.settings.localServerKeepAlive) {
      void this.stopLocalServer("Plugin unloaded.");
    }
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
      localServerModeEnabled: saved?.localServerModeEnabled ?? DEFAULT_SETTINGS.localServerModeEnabled,
      localServerPort: saved?.localServerPort ?? DEFAULT_SETTINGS.localServerPort,
      localServerKeepAlive: saved?.localServerKeepAlive ?? DEFAULT_SETTINGS.localServerKeepAlive,
      localServerDataDir: saved?.localServerDataDir ?? DEFAULT_SETTINGS.localServerDataDir,
      localServerMcpToken: saved?.localServerMcpToken ?? DEFAULT_SETTINGS.localServerMcpToken,
      localServerSyncToken: saved?.localServerSyncToken ?? DEFAULT_SETTINGS.localServerSyncToken,
      localServerCredentialsCreatedAt: saved?.localServerCredentialsCreatedAt ?? DEFAULT_SETTINGS.localServerCredentialsCreatedAt,
      localServerProjectDir: saved?.localServerProjectDir ?? DEFAULT_SETTINGS.localServerProjectDir,
      localServerCommand: saved?.localServerCommand ?? DEFAULT_SETTINGS.localServerCommand,
      localFsAccessMode: saved?.localFsAccessMode ?? DEFAULT_SETTINGS.localFsAccessMode,
      localFsReadRoots: saved?.localFsReadRoots ?? DEFAULT_SETTINGS.localFsReadRoots,
      localFsWriteRoots: saved?.localFsWriteRoots ?? DEFAULT_SETTINGS.localFsWriteRoots,
      localFsWriteOperations: saved?.localFsWriteOperations ?? DEFAULT_SETTINGS.localFsWriteOperations,
      localFsMaxReadBytes: saved?.localFsMaxReadBytes ?? DEFAULT_SETTINGS.localFsMaxReadBytes,
      localFsMaxSearchResults: saved?.localFsMaxSearchResults ?? DEFAULT_SETTINGS.localFsMaxSearchResults,
      localFsMaxSearchFiles: saved?.localFsMaxSearchFiles ?? DEFAULT_SETTINGS.localFsMaxSearchFiles,
      localFsAccessTtlMinutes: saved?.localFsAccessTtlMinutes ?? DEFAULT_SETTINGS.localFsAccessTtlMinutes,
      localFsRequireUserIntent: saved?.localFsRequireUserIntent ?? DEFAULT_SETTINGS.localFsRequireUserIntent,
      localFsUserIntentPhrase: saved?.localFsUserIntentPhrase ?? DEFAULT_SETTINGS.localFsUserIntentPhrase,
      hostedLocalBridgeEnabled: false,
      hostedLocalBridgePollSeconds: saved?.hostedLocalBridgePollSeconds ?? DEFAULT_SETTINGS.hostedLocalBridgePollSeconds,
    };
    this.syncHistory = saved?.syncHistory?.slice(0, 20) ?? [];
  }

  async saveSettings() {
    await this.saveData({
      ...pluginDataForPersistence(this.settings),
      syncHistory: this.syncHistory.slice(0, 20),
    });
  }

  async generateLocalServerCredentials() {
    this.settings = {
      ...this.settings,
      localServerMcpToken: generateLocalToken(),
      localServerSyncToken: generateLocalToken(),
      localServerCredentialsCreatedAt: new Date().toISOString(),
    };
    await this.saveSettings();
    new Notice("Vault MCP: generated local server credentials.");
  }

  async startLocalServer() {
    if (this.localServerProcess) {
      new Notice(`Vault MCP local server is already running${this.localServerProcess.pid ? ` (pid ${this.localServerProcess.pid})` : ""}.`);
      return;
    }

    if (!this.settings.localServerMcpToken.trim() || !this.settings.localServerSyncToken.trim()) {
      await this.generateLocalServerCredentials();
    }

    try {
      const portSelection = await selectLocalServerPort(this.settings, this.manifest.version);
      if (portSelection.port !== this.settings.localServerPort) {
        this.settings.localServerPort = portSelection.port;
        await this.saveSettings();
      }
      await this.addHistory({ type: "local-server", message: portSelection.message });
      if (portSelection.reused && portSelection.health) {
        this.localServerStartedAt = new Date().toISOString();
        this.localServerHealth = portSelection.health;
        this.settings.localServerModeEnabled = true;
        await this.saveSettings();
        new Notice(`Vault MCP local server ready on ${localServerEndpoint(this.settings)}.`);
        return;
      }

      const config = buildLocalServerSpawnConfig(this.localServerSettingsWithSidecar());
      if (!config) {
        const message = "Set the local server project folder, command, valid port, and local credentials before starting the developer local server.";
        await this.addHistory({ type: "error", message });
        new Notice(`Vault MCP: ${message}`);
        this.settings.localServerModeEnabled = false;
        await this.saveSettings();
        return;
      }

      const child = spawnLocalServerProcess(config);
      this.localServerProcess = child;
      this.localServerStartedAt = new Date().toISOString();
      this.localServerHealth = null;
      this.settings.localServerModeEnabled = true;
      await this.saveSettings();
      await this.addHistory({ type: "local-server", message: `Starting local server on ${localServerEndpoint(this.settings)}.` });
      child.on("error", (error) => {
        if (this.localServerProcess === child) {
          this.localServerProcess = null;
          this.localServerStartedAt = null;
          this.localServerHealth = null;
          this.settings.localServerModeEnabled = false;
          void this.saveSettings();
        }
        void this.addHistory({ type: "error", message: `Local server failed to start: ${error.message}` });
        new Notice(`Vault MCP local server failed to start: ${error.message}`);
      });
      child.on("exit", (code, signal) => {
        if (this.localServerProcess === child) {
          this.localServerProcess = null;
          this.localServerStartedAt = null;
          this.localServerHealth = null;
          this.settings.localServerModeEnabled = false;
          void this.saveSettings();
        }
        const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        void this.addHistory({ type: "local-server", message: `Developer local server stopped (${reason}).` });
      });
      new Notice(`Vault MCP local server starting on ${localServerEndpoint(this.settings)}.`);
      const health = await waitForLocalServerHealth(this.settings, this.manifest.version);
      if (this.localServerProcess !== child) {
        return;
      }
      this.localServerHealth = health;
      await this.addHistory({ type: "local-server", message: `Local server ready on ${localServerEndpoint(this.settings)} (${health.storage?.kind ?? "unknown"} storage, version ${health.service?.version ?? "unknown"}).` });
      new Notice(`Vault MCP local server ready on ${localServerEndpoint(this.settings)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.localServerProcess?.kill("SIGTERM");
      this.localServerProcess = null;
      this.localServerStartedAt = null;
      this.localServerHealth = null;
      this.settings.localServerModeEnabled = false;
      await this.saveSettings();
      await this.addHistory({ type: "error", message: `Local server start failed: ${message}` });
      new Notice(`Vault MCP local server start failed: ${message}`);
    }
  }

  async stopLocalServer(reason = "Stopped by user.") {
    const child = this.localServerProcess;
    if (!child) {
      if (this.settings.localServerModeEnabled || this.localServerHealth) {
        this.localServerStartedAt = null;
        this.localServerHealth = null;
        this.settings.localServerModeEnabled = false;
        await this.saveSettings();
        await this.addHistory({ type: "local-server", message: "Disconnected from the compatible local server. No Obsidian-owned process was running." });
        new Notice("Vault MCP local server disconnected. No Obsidian-owned process was running.");
        return;
      }
      this.settings.localServerModeEnabled = false;
      await this.saveSettings();
      new Notice("Vault MCP local server is not running.");
      return;
    }
    this.localServerProcess = null;
    this.localServerStartedAt = null;
    this.localServerHealth = null;
    this.settings.localServerModeEnabled = false;
    await this.saveSettings();
    child.kill("SIGTERM");
    await this.addHistory({ type: "local-server", message: reason });
    new Notice("Vault MCP local server stop requested.");
  }

  async refreshLocalServerSession() {
    if (!this.localServerProcess) {
      await this.addHistory({ type: "local-server", message: "Starting developer local server to create a fresh local filesystem access session." });
      await this.startLocalServer();
      return;
    }

    const child = this.localServerProcess;
    this.localServerProcess = null;
    this.localServerStartedAt = null;
    this.localServerHealth = null;
    this.settings.localServerModeEnabled = false;
    await this.saveSettings();
    child.kill("SIGTERM");
    await this.addHistory({ type: "local-server", message: `Refreshing local filesystem access session on ${localServerEndpoint(this.settings)}.` });
    new Notice("Vault MCP local server session refresh requested.");
    await delay(750);
    await this.startLocalServer();
  }

  async startHostedLocalBridge(persist = true) {
    if (!this.settings.syncToken.trim()) {
      const message = "Add the hosted server sync token before enabling the ChatGPT desktop bridge.";
      this.hostedLocalBridgeLastError = message;
      new Notice(`Vault MCP: ${message}`);
      return;
    }
    this.settings.hostedLocalBridgeEnabled = true;
    if (persist) {
      await this.saveSettings();
    }
    if (!this.localServerHealth) {
      await this.startLocalServer();
    }
    if (!this.localServerHealth) {
      try {
        this.localServerHealth = await fetchLocalServerHealth(this.settings);
      } catch (error) {
        const message = describeCaughtError("hosted desktop bridge local server check", error);
        this.hostedLocalBridgeLastError = message;
        await this.addHistory({ type: "error", message: `Hosted desktop bridge could not start: ${message}` });
        new Notice(`Vault MCP hosted desktop bridge could not start: ${message}`);
        return;
      }
    }
    this.hostedLocalBridgeConnectedAt ??= new Date().toISOString();
    this.hostedLocalBridgeLastError = null;
    this.scheduleHostedLocalBridge();
    await this.runHostedLocalBridgeTick();
    await this.addHistory({ type: "hosted-bridge", message: "Hosted ChatGPT desktop bridge enabled. Files remain local until an authenticated chat requests one operation." });
    new Notice("Vault MCP hosted ChatGPT desktop bridge enabled.");
  }

  async stopHostedLocalBridge(persist = true) {
    this.clearHostedLocalBridgeTimer();
    this.settings.hostedLocalBridgeEnabled = false;
    this.hostedLocalBridgeConnectedAt = null;
    this.hostedLocalBridgeLastSeenAt = null;
    this.hostedLocalBridgeLastError = null;
    if (persist) {
      await this.saveSettings();
    }
    await this.addHistory({ type: "hosted-bridge", message: "Hosted ChatGPT desktop bridge disabled." });
    new Notice("Vault MCP hosted ChatGPT desktop bridge disabled.");
  }

  scheduleHostedLocalBridge() {
    this.clearHostedLocalBridgeTimer();
    const pollMs = Math.max(1, Math.trunc(this.settings.hostedLocalBridgePollSeconds)) * 1_000;
    this.hostedLocalBridgeTimer = window.setInterval(() => {
      void this.runHostedLocalBridgeTick();
    }, pollMs);
    this.registerInterval(this.hostedLocalBridgeTimer);
  }

  private clearHostedLocalBridgeTimer() {
    if (this.hostedLocalBridgeTimer !== null) {
      window.clearInterval(this.hostedLocalBridgeTimer);
      this.hostedLocalBridgeTimer = null;
    }
  }

  async runHostedLocalBridgeTick() {
    if (!this.settings.hostedLocalBridgeEnabled || this.hostedLocalBridgeBusy) {
      return;
    }
    this.hostedLocalBridgeBusy = true;
    try {
      const policy = this.settings.localFsAccessMode === "off"
        ? localFsPolicyFromPluginSettings(this.settings, this.localServerStartedAt)
        : localFsPolicyFromMcpResponse(await callLocalMcpTool(this.settings, "local_fs_policy", {}));
      const tools = await listLocalMcpTools(this.settings);
      await this.sendHostedLocalBridgeHeartbeat(policy, tools);
      const request = await this.claimHostedLocalAccessRequest();
      if (request) {
        await this.executeHostedLocalAccessRequest(request);
      }
      this.hostedLocalBridgeLastSeenAt = new Date().toISOString();
      this.hostedLocalBridgeLastError = null;
    } catch (error) {
      const message = describeCaughtError("hosted desktop bridge", error);
      if (message !== this.hostedLocalBridgeLastError) {
        await this.addHistory({ type: "error", message: `Hosted desktop bridge error: ${message}` });
      }
      this.hostedLocalBridgeLastError = message;
    } finally {
      this.hostedLocalBridgeBusy = false;
    }
  }

  private async sendHostedLocalBridgeHeartbeat(policy: LocalFsPolicy, tools: LocalAgentToolDefinition[]) {
    const response = await requestUrl({
      url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/local-agent/heartbeat`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.syncToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: this.settings.tenantId,
        installation_id: this.settings.installationId,
        agent_version: this.manifest.version,
        policy,
        tools,
        connected_at: this.hostedLocalBridgeConnectedAt ?? new Date().toISOString(),
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(describeHttpFailure("hosted desktop bridge heartbeat", response.status, response.text));
    }
  }

  private async claimHostedLocalAccessRequest(): Promise<LocalAccessRequest | null> {
    const response = await requestUrl({
      url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/local-access-requests/next?tenant_id=${encodeURIComponent(this.settings.tenantId)}&installation_id=${encodeURIComponent(this.settings.installationId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${this.settings.syncToken}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(describeHttpFailure("hosted desktop bridge request poll", response.status, response.text));
    }
    return parseJsonResponse<{ request: LocalAccessRequest | null }>(response.text, "hosted desktop bridge request").request;
  }

  private async executeHostedLocalAccessRequest(request: LocalAccessRequest) {
    if (request.vault_id !== this.settings.vaultId || request.installation_id !== this.settings.installationId) {
      throw new Error("Hosted desktop request scope did not match this plugin installation.");
    }
    try {
      const result = await callLocalMcpTool(this.settings, request.tool_name, request.arguments);
      await this.postHostedLocalAccessResult(request, "completed", result, null);
      await this.addHistory({ type: "hosted-bridge", message: `Completed hosted desktop request ${request.id}: ${request.tool_name}.` });
    } catch (error) {
      const message = describeCaughtError(`local tool ${request.tool_name}`, error);
      await this.postHostedLocalAccessResult(request, "failed", null, {
        code: "LOCAL_TOOL_FAILED",
        message,
      });
      await this.addHistory({ type: "error", message: `Hosted desktop request ${request.id} failed: ${message}` });
    }
  }

  private async postHostedLocalAccessResult(
    request: LocalAccessRequest,
    status: "completed" | "failed",
    result: Record<string, unknown> | null,
    error: { code: string; message: string } | null,
  ) {
    const response = await requestUrl({
      url: `${this.serverBaseUrl()}/admin/vaults/${encodeURIComponent(this.settings.vaultId)}/local-access-requests/${encodeURIComponent(request.id)}/result`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.syncToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: this.settings.tenantId,
        installation_id: this.settings.installationId,
        status,
        result,
        error,
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(describeHttpFailure("hosted desktop bridge result", response.status, response.text));
    }
  }

  localServerSettingsWithSidecar(): VaultMcpPluginSettings & { localServerSidecarDir?: string } {
    const localServerSidecarDir = resolveBundledLocalSidecarDir(this.app, this.manifest);
    return localServerSidecarDir ? { ...this.settings, localServerSidecarDir } : this.settings;
  }

  async importSetupBundle(value: string) {
    try {
      const bundle = parsePluginSetupBundle(value);
      this.settings = {
        ...this.settings,
        serverUrl: bundle.serverUrl,
        syncToken: bundle.syncToken,
        tenantId: bundle.tenantId,
        vaultId: bundle.vaultId,
        indexMode: bundle.indexMode,
        writeMode: bundle.writeMode,
      };
      this.serverCheck = null;
      await this.saveSettings();
      await this.addHistory({
        type: "setup-import",
        message: `Imported setup bundle for ${bundle.serverUrl} as vault ${bundle.vaultId}.`,
      });
      new Notice("Vault MCP: setup bundle imported. Run Check connection next.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.summary = { ...this.summary, lastError: message };
      await this.addHistory({ type: "error", message });
      new Notice(`Vault MCP: ${message}`);
      throw error;
    }
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
    addSetupGuide(contentEl, this.plugin.settings);
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

    addSetupGuide(containerEl, this.plugin.settings);
    addSafetyDisclosure(containerEl, this.plugin.settings);
    addConfigurationChecklist(containerEl, this.plugin.settings);
    addServerCheckSection(containerEl, this.plugin.serverCheck);

    let setupBundleText = "";
    new Setting(containerEl)
      .setName("Import setup bundle")
      .setDesc("Paste the JSON bundle generated by /setup/vercel to fill server URL, sync token, vault id, index mode, and write mode.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.inputEl.placeholder = "{\"type\":\"vault-mcp-plugin-setup\",...}";
        text.onChange((value) => {
          setupBundleText = value;
        });
      })
      .addButton((button) => button
        .setButtonText("Import bundle")
        .setCta()
        .onClick(async () => {
          await this.plugin.importSetupBundle(setupBundleText);
          this.display();
        }));

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

    addLocalServerSection(containerEl, this.plugin);

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

function addSetupGuide(parent: HTMLElement, settings: VaultMcpPluginSettings) {
  const guide = pluginSetupGuide(settings);
  const box = parent.createDiv({ cls: "vault-mcp-setup" });
  box.createDiv({ cls: "vault-mcp-setup__eyebrow", text: "First-run setup" });
  box.createDiv({ cls: "vault-mcp-setup__title", text: guide.title });
  box.createDiv({ cls: "vault-mcp-setup__summary", text: guide.summary });

  const endpoint = box.createDiv({ cls: "vault-mcp-copy-value" });
  const endpointBody = endpoint.createDiv({ cls: "vault-mcp-copy-value__body" });
  endpointBody.createDiv({ cls: "vault-mcp-dashboard__label", text: "MCP endpoint for clients" });
  endpointBody.createDiv({ cls: "vault-mcp-copy-value__text", text: guide.endpoint });
  new Setting(endpoint.createDiv({ cls: "vault-mcp-copy-value__action" }))
    .addButton((button) => button
      .setButtonText("Copy")
      .onClick(() => void copyToClipboard("MCP endpoint", guide.endpoint)));

  const steps = box.createDiv({ cls: "vault-mcp-setup-steps" });
  for (const step of guide.steps) {
    const row = steps.createDiv({ cls: `vault-mcp-setup-step vault-mcp-setup-step--${step.status}` });
    row.createDiv({ cls: "vault-mcp-setup-step__status", text: step.status });
    const body = row.createDiv({ cls: "vault-mcp-setup-step__body" });
    body.createDiv({ cls: "vault-mcp-setup-step__label", text: step.label });
    body.createDiv({ cls: "vault-mcp-setup-step__message", text: step.message });
  }

  const hostingDetails = box.createEl("details", { cls: "vault-mcp-setup-section" });
  hostingDetails.open = true;
  hostingDetails.createEl("summary", { text: "Choose hosting" });
  const hostingList = hostingDetails.createDiv({ cls: "vault-mcp-setup-card-grid" });
  for (const option of guide.hostingOptions) {
    const card = hostingList.createDiv({ cls: `vault-mcp-setup-card vault-mcp-setup-card--${option.status}` });
    const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
    header.createDiv({ cls: "vault-mcp-preview-card__title", text: option.label });
    header.createDiv({ cls: "vault-mcp-chip vault-mcp-chip--review", text: option.status });
    card.createDiv({ cls: "vault-mcp-preview-card__reason", text: option.summary });
    const list = card.createEl("ol", { cls: "vault-mcp-setup-card__list" });
    for (const item of option.steps) {
      list.createEl("li", { text: item });
    }
    if (option.actionUrl) {
      const actions = card.createDiv({ cls: "vault-mcp-setup-card__actions" });
      new Setting(actions)
        .addButton((button) => button
          .setButtonText(option.actionLabel ?? "Open guide")
          .setCta()
          .onClick(() => openExternalUrl(option.actionUrl ?? "")))
        .addButton((button) => button
          .setButtonText("Copy link")
          .onClick(() => void copyToClipboard(option.actionLabel ?? "setup guide", option.actionUrl ?? "")));
    }
  }

  const clientsDetails = box.createEl("details", { cls: "vault-mcp-setup-section" });
  clientsDetails.open = true;
  clientsDetails.createEl("summary", { text: "Connect an MCP client" });
  const clientList = clientsDetails.createDiv({ cls: "vault-mcp-setup-card-grid" });
  for (const client of guide.clientCards) {
    const card = clientList.createDiv({ cls: "vault-mcp-setup-card" });
    const header = card.createDiv({ cls: "vault-mcp-preview-card__header" });
    header.createDiv({ cls: "vault-mcp-preview-card__title", text: client.label });
    header.createDiv({ cls: "vault-mcp-chip vault-mcp-chip--review", text: client.status });
    card.createDiv({ cls: "vault-mcp-preview-card__reason", text: client.auth });
    const value = card.createDiv({ cls: "vault-mcp-copy-value vault-mcp-copy-value--compact" });
    value.createDiv({ cls: "vault-mcp-copy-value__text", text: client.endpoint });
    new Setting(value.createDiv({ cls: "vault-mcp-copy-value__action" }))
      .addButton((button) => button
        .setButtonText("Copy endpoint")
        .onClick(() => void copyToClipboard(`${client.label} endpoint`, client.endpoint)));
    const list = card.createEl("ol", { cls: "vault-mcp-setup-card__list" });
    for (const item of client.steps) {
      list.createEl("li", { text: item });
    }
    const prompt = card.createDiv({ cls: "vault-mcp-copy-value vault-mcp-copy-value--compact" });
    prompt.createDiv({ cls: "vault-mcp-copy-value__text", text: client.testPrompt });
    new Setting(prompt.createDiv({ cls: "vault-mcp-copy-value__action" }))
      .addButton((button) => button
        .setButtonText("Copy test")
        .onClick(() => void copyToClipboard(`${client.label} test prompt`, client.testPrompt)));
  }

  const recovery = box.createEl("details", { cls: "vault-mcp-setup-section" });
  recovery.createEl("summary", { text: "Recovery actions" });
  const list = recovery.createEl("ul", { cls: "vault-mcp-disclosure__list" });
  for (const item of guide.recoveryActions) {
    list.createEl("li", { text: item });
  }
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

function addLocalServerSection(parent: HTMLElement, plugin: VaultMcpPlugin) {
  const localServerSettings = plugin.localServerSettingsWithSidecar();
  const status = pluginLocalServerStatus(localServerSettings);
  new Setting(parent).setName("Local desktop server").setHeading();

  const box = parent.createDiv({ cls: `vault-mcp-server-check vault-mcp-server-check--${status.status}` });
  box.createDiv({ cls: "vault-mcp-server-check__title", text: status.title });
  box.createDiv({ cls: "vault-mcp-server-check__message", text: status.message });
  const endpoint = box.createDiv({ cls: "vault-mcp-copy-value vault-mcp-copy-value--compact" });
  endpoint.createDiv({ cls: "vault-mcp-copy-value__text", text: status.endpoint });
  new Setting(endpoint.createDiv({ cls: "vault-mcp-copy-value__action" }))
    .addButton((button) => button
      .setButtonText("Copy endpoint")
      .onClick(() => void copyToClipboard("local MCP endpoint", status.endpoint)));
  const facts = box.createEl("ul", { cls: "vault-mcp-server-check__facts" });
  for (const fact of status.facts) {
    facts.createEl("li", { text: fact });
  }

  new Setting(parent)
    .setName("Run local MCP server")
    .setDesc("Starts or stops the packaged local sidecar when available, or the Node-required developer local server profile as a fallback.")
    .addToggle((toggle) => toggle
      .setValue(Boolean(plugin.localServerProcess) || plugin.settings.localServerModeEnabled)
      .onChange(async (value) => {
        if (value) {
          await plugin.startLocalServer();
        } else {
          await plugin.stopLocalServer();
        }
        openPluginSettings(plugin.app, plugin);
      }));

  new Setting(parent)
    .setName("Local server port")
    .setDesc("Preferred localhost port. If it is occupied, start scans upward for the next available compatible port.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1024";
      text.inputEl.max = "65535";
      text.setValue(String(plugin.settings.localServerPort))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.localServerPort = Number.isInteger(parsed) ? parsed : DEFAULT_SETTINGS.localServerPort;
          await plugin.saveSettings();
        });
    });

  new Setting(parent)
    .setName("Local server data folder")
    .setDesc("Local JSON storage folder for the sidecar. Relative paths resolve from the sidecar folder or repo profile.")
    .addText((text) => text
      .setValue(plugin.settings.localServerDataDir)
      .onChange(async (value) => {
        plugin.settings.localServerDataDir = value.trim() || DEFAULT_SETTINGS.localServerDataDir;
        await plugin.saveSettings();
      }));

  new Setting(parent)
    .setName("Developer project folder")
    .setDesc("Private-alpha path to the Vault MCP platform repo. Required until a packaged sidecar is bundled with the plugin.")
    .addText((text) => text
      .setPlaceholder("/absolute/path/to/vault-mcp/platform")
      .setValue(plugin.settings.localServerProjectDir)
      .onChange(async (value) => {
        plugin.settings.localServerProjectDir = value.trim();
        await plugin.saveSettings();
      }));

  new Setting(parent)
    .setName("Developer command")
    .setDesc("Executable used to run npm scripts. Use an absolute npm path if Obsidian cannot find npm from the macOS app environment.")
    .addText((text) => text
      .setPlaceholder("npm")
      .setValue(plugin.settings.localServerCommand)
      .onChange(async (value) => {
        plugin.settings.localServerCommand = value.trim() || DEFAULT_SETTINGS.localServerCommand;
        await plugin.saveSettings();
      }));

  new Setting(parent)
    .setName("Local filesystem access")
    .setDesc("Default is off. Read and write modes stay inside configured roots. God mode removes root limits for this localhost server.")
    .addDropdown((dropdown) => dropdown
      .addOption("off", "Off")
      .addOption("read", "Read inside roots")
      .addOption("write", "Read/write inside roots")
      .addOption("god", "God mode")
      .setValue(plugin.settings.localFsAccessMode)
      .onChange(async (value) => {
        plugin.settings.localFsAccessMode = value as LocalFsAccessMode;
        await plugin.saveSettings();
      }));

  const vaultBasePath = getVaultBasePath(plugin.app);
  addListSetting(parent, "Local filesystem read roots", "Absolute folders the local MCP server may list and read. Leave empty when access is off or when using god mode.", plugin.settings.localFsReadRoots, async (values) => {
    plugin.settings.localFsReadRoots = values;
    await plugin.saveSettings();
  });
  addRootShortcut(parent, "Use vault folder for read root", vaultBasePath, async (root) => {
    plugin.settings.localFsReadRoots = uniqueStrings([...plugin.settings.localFsReadRoots, root]);
    await plugin.saveSettings();
    openPluginSettings(plugin.app, plugin);
  });

  addListSetting(parent, "Local filesystem write roots", "Absolute folders the local MCP server may write to when write mode is enabled. Keep this narrower than read roots unless you deliberately need broad write access.", plugin.settings.localFsWriteRoots, async (values) => {
    plugin.settings.localFsWriteRoots = values;
    await plugin.saveSettings();
  });
  addRootShortcut(parent, "Use vault folder for write root", vaultBasePath, async (root) => {
    plugin.settings.localFsWriteRoots = uniqueStrings([...plugin.settings.localFsWriteRoots, root]);
    await plugin.saveSettings();
    openPluginSettings(plugin.app, plugin);
  });

  addLocalFsWriteOperationToggles(parent, plugin);

  new Setting(parent)
    .setName("Local max read bytes")
    .setDesc("Upper bound for one local_read_file, local_read_files file entry, or local_read_file_bytes result. The server also caps tool-provided max_bytes to this value.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.setValue(String(plugin.settings.localFsMaxReadBytes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.localFsMaxReadBytes = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.localFsMaxReadBytes;
          await plugin.saveSettings();
        });
    });

  new Setting(parent)
    .setName("Local max search results")
    .setDesc("Upper bound for one local_find_files or local_search_text result set.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.setValue(String(plugin.settings.localFsMaxSearchResults))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.localFsMaxSearchResults = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.localFsMaxSearchResults;
          await plugin.saveSettings();
        });
    });

  new Setting(parent)
    .setName("Local max searched files")
    .setDesc("Upper bound for files scanned by one local_search_text call.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.setValue(String(plugin.settings.localFsMaxSearchFiles))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.localFsMaxSearchFiles = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.localFsMaxSearchFiles;
          await plugin.saveSettings();
        });
    });

  new Setting(parent)
    .setName("Local access session minutes")
    .setDesc("Expiry window for the next local server start. Use 0 only when you deliberately want filesystem access to stay available until the server stops.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.setValue(String(plugin.settings.localFsAccessTtlMinutes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.localFsAccessTtlMinutes = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SETTINGS.localFsAccessTtlMinutes;
          await plugin.saveSettings();
        });
    });

  new Setting(parent)
    .setName("Require local user intent")
    .setDesc("Requires MCP clients to include the exact user intent phrase on every local filesystem tool call. Keep this on unless you are testing.")
    .addToggle((toggle) => toggle
      .setValue(plugin.settings.localFsRequireUserIntent)
      .onChange(async (value) => {
        plugin.settings.localFsRequireUserIntent = value;
        await plugin.saveSettings();
      }));

  new Setting(parent)
    .setName("Local user intent phrase")
    .setDesc("Exact phrase MCP clients must send as user_intent before local filesystem tools run.")
    .addText((text) => text
      .setValue(plugin.settings.localFsUserIntentPhrase)
      .onChange(async (value) => {
        plugin.settings.localFsUserIntentPhrase = value.trim() || DEFAULT_SETTINGS.localFsUserIntentPhrase;
        await plugin.saveSettings();
      }));

  new Setting(parent)
    .setName("Local credentials")
    .setDesc("Generates separate local-only tokens for MCP clients and plugin/admin sync. These are for the future sidecar and developer launcher.")
    .addButton((button) => button
      .setButtonText(plugin.settings.localServerMcpToken && plugin.settings.localServerSyncToken ? "Rotate" : "Generate")
      .onClick(async () => {
        await plugin.generateLocalServerCredentials();
        button.setButtonText("Rotate");
      }))
    .addButton((button) => button
      .setButtonText("Copy MCP token")
      .onClick(() => void copyToClipboard("local MCP token", plugin.settings.localServerMcpToken)))
    .addButton((button) => button
      .setButtonText("Copy sync token")
      .onClick(() => void copyToClipboard("local sync token", plugin.settings.localServerSyncToken)));

  const localClientBundle = buildLocalClientConnectionBundle(plugin.settings);
  new Setting(parent)
    .setName("Local client connection")
    .setDesc("Copy values for local-capable MCP clients. This includes the local MCP client token, never the plugin/admin sync token.")
    .addButton((button) => button
      .setButtonText("Copy auth header")
      .onClick(() => void copyToClipboard("local MCP authorization header", localClientBundle?.authorization_header ?? "")))
    .addButton((button) => button
      .setButtonText("Copy JSON")
      .onClick(() => void copyToClipboard("local MCP client JSON", localClientBundle ? JSON.stringify(localClientBundle, null, 2) : "")))
    .addButton((button) => button
      .setButtonText("Copy instructions")
      .onClick(() => void copyToClipboard("local MCP client instructions", buildLocalClientInstructions(plugin.settings) ?? "")));

  new Setting(parent)
    .setName("Developer launch command")
    .setDesc("Starts the current Node-required local profile with this plugin's port, data folder, and local tokens.")
    .addButton((button) => button
      .setButtonText("Copy command")
      .onClick(() => void copyToClipboard("local server launch command", buildLocalServerLaunchCommand(localServerSettings) ?? "")));

  new Setting(parent)
    .setName("Developer server session")
    .setDesc(localServerSessionDescription(plugin))
    .addButton((button) => button
      .setButtonText("Start")
      .setCta()
      .setDisabled(Boolean(plugin.localServerProcess))
      .onClick(async () => {
        await plugin.startLocalServer();
        openPluginSettings(plugin.app, plugin);
      }))
    .addButton((button) => button
      .setButtonText("Refresh session")
      .setDisabled(!plugin.localServerProcess)
      .onClick(async () => {
        await plugin.refreshLocalServerSession();
        openPluginSettings(plugin.app, plugin);
      }))
    .addButton((button) => button
      .setButtonText("Stop")
      .setDisabled(!plugin.localServerProcess && !plugin.settings.localServerModeEnabled)
      .onClick(async () => {
        await plugin.stopLocalServer();
        openPluginSettings(plugin.app, plugin);
      }));

  new Setting(parent)
    .setName("Keep local server running")
    .setDesc("Opt-in. The safe default stops the developer sidecar when Obsidian unloads.")
    .addToggle((toggle) => toggle
      .setValue(plugin.settings.localServerKeepAlive)
      .onChange(async (value) => {
        plugin.settings.localServerKeepAlive = value;
        await plugin.saveSettings();
      }));

  new Setting(parent).setName("Hosted ChatGPT desktop bridge").setHeading();
  parent.createEl("p", {
    cls: "vault-mcp-muted",
    text: "Opt-in for the current Obsidian session only. While enabled, the plugin polls the hosted server for short-lived desktop requests and forwards each one to the localhost sidecar. It never uploads a filesystem inventory or reads files in the background, and it never resumes hosted access after Obsidian reloads or reopens.",
  });

  new Setting(parent)
    .setName("Allow hosted ChatGPT to use local tools")
    .setDesc("The localhost sidecar still enforces access mode, roots, write-operation toggles, expiry, exact user intent, and audit. Off is the default and every new Obsidian session starts off.")
    .addToggle((toggle) => toggle
      .setValue(plugin.settings.hostedLocalBridgeEnabled)
      .onChange(async (enabled) => {
        if (enabled) {
          await plugin.startHostedLocalBridge();
        } else {
          await plugin.stopHostedLocalBridge();
        }
        openPluginSettings(plugin.app, plugin);
      }));

  new Setting(parent)
    .setName("Hosted bridge poll seconds")
    .setDesc("How often the plugin checks for one authenticated desktop request. One second is recommended for interactive chat.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = "30";
      text.setValue(String(plugin.settings.hostedLocalBridgePollSeconds))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          plugin.settings.hostedLocalBridgePollSeconds = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30
            ? parsed
            : DEFAULT_SETTINGS.hostedLocalBridgePollSeconds;
          await plugin.saveSettings();
          if (plugin.settings.hostedLocalBridgeEnabled) {
            plugin.scheduleHostedLocalBridge();
            await plugin.runHostedLocalBridgeTick();
          }
        });
    });

  new Setting(parent)
    .setName("Hosted bridge session")
    .setDesc(hostedLocalBridgeDescription(plugin))
    .addButton((button) => button
      .setButtonText("Check now")
      .setDisabled(!plugin.settings.hostedLocalBridgeEnabled)
      .onClick(async () => {
        await plugin.runHostedLocalBridgeTick();
        openPluginSettings(plugin.app, plugin);
      }))
    .addButton((button) => button
      .setButtonText("Disable")
      .setDisabled(!plugin.settings.hostedLocalBridgeEnabled)
      .onClick(async () => {
        await plugin.stopHostedLocalBridge();
        openPluginSettings(plugin.app, plugin);
      }));
}

function localServerSessionDescription(plugin: VaultMcpPlugin): string {
  if (plugin.localServerProcess) {
    return `Running${plugin.localServerProcess.pid ? ` as pid ${plugin.localServerProcess.pid}` : ""}${plugin.localServerStartedAt ? ` since ${plugin.localServerStartedAt}` : ""}${plugin.localServerHealth ? `; health ok (${plugin.localServerHealth.storage?.kind ?? "unknown"} storage, version ${plugin.localServerHealth.service?.version ?? "unknown"})` : "; waiting for health and version check"}. Refresh restarts the local server with a new filesystem access window.`;
  }
  if (plugin.settings.localServerModeEnabled && plugin.localServerHealth) {
    return `Connected to an existing compatible local server on ${localServerEndpoint(plugin.settings)} (${plugin.localServerHealth.storage?.kind ?? "unknown"} storage, version ${plugin.localServerHealth.service?.version ?? "unknown"}). Stop disconnects this plugin; it cannot stop a process started outside this Obsidian session.`;
  }
  return "Stopped. Start uses the configured project folder, command, port, data folder, and local credentials.";
}

function hostedLocalBridgeDescription(plugin: VaultMcpPlugin): string {
  if (!plugin.settings.hostedLocalBridgeEnabled) {
    return "Disabled for this Obsidian session. Hosted MCP clients cannot request local filesystem operations.";
  }
  if (plugin.hostedLocalBridgeLastError) {
    return `Enabled but blocked: ${plugin.hostedLocalBridgeLastError}`;
  }
  if (plugin.hostedLocalBridgeLastSeenAt) {
    return `Connected. Last successful poll: ${plugin.hostedLocalBridgeLastSeenAt}. Access mode: ${plugin.settings.localFsAccessMode}.`;
  }
  return "Enabled and starting. Keep Obsidian open while using local tools from ChatGPT.";
}

function addLocalFsWriteOperationToggles(parent: HTMLElement, plugin: VaultMcpPlugin) {
  new Setting(parent)
    .setName("Allowed local write operations")
    .setDesc("These only apply when local filesystem access is Write or God mode. Keep destructive operations off until you deliberately need them.");
  const options: Array<{ value: LocalFsWriteOperation; label: string; description: string }> = [
    { value: "write_file", label: "Write files", description: "Create, overwrite, or append text files and base64 byte files." },
    { value: "edit_file", label: "Edit exact text", description: "Replace exact text in existing UTF-8 files only when the expected match count is confirmed." },
    { value: "create_directory", label: "Create directories", description: "Create folders inside allowed write roots." },
    { value: "copy_path", label: "Copy files or folders", description: "Copy readable files or folders into allowed write roots." },
    { value: "move_path", label: "Move or rename", description: "Rename or move files and folders inside allowed write roots." },
    { value: "delete_path", label: "Delete paths", description: "Delete files or folders; tool calls require an explicit confirmation string." },
  ];
  for (const option of options) {
    new Setting(parent)
      .setName(option.label)
      .setDesc(option.description)
      .addToggle((toggle) => toggle
        .setValue(plugin.settings.localFsWriteOperations.includes(option.value))
        .onChange(async (enabled) => {
          const current = new Set(plugin.settings.localFsWriteOperations);
          if (enabled) {
            current.add(option.value);
          } else {
            current.delete(option.value);
          }
          plugin.settings.localFsWriteOperations = Array.from(current);
          await plugin.saveSettings();
        }));
  }
}

function addRootShortcut(parent: HTMLElement, name: string, root: string | null, onUse: (root: string) => Promise<void>) {
  if (!root) {
    return;
  }
  new Setting(parent)
    .setName(name)
    .setDesc(root)
    .addButton((button) => button
      .setButtonText("Add")
      .onClick(() => void onUse(root)));
}

function getVaultBasePath(app: App): string | null {
  const adapter = app.vault.adapter as { getBasePath?: () => string };
  const basePath = adapter.getBasePath?.();
  return basePath?.trim() || null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

async function copyToClipboard(label: string, value: string) {
  if (!value || value === "Set a valid server URL first.") {
    new Notice(`Vault MCP: ${label} is not ready to copy.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    new Notice(`Vault MCP: copied ${label}.`);
  } catch {
    new Notice(`Vault MCP: could not copy ${label}. Select and copy it manually.`);
  }
}

function generateLocalToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function spawnLocalServerProcess(config: LocalServerSpawnConfig): LocalServerChildProcess {
  const { spawn } = requireNodeModule<ChildProcessModule>("child_process");
  return spawn(config.command, config.args, {
    cwd: config.cwd,
    detached: false,
    shell: false,
    stdio: "ignore",
    env: localServerSpawnEnv(config),
  });
}

function resolveBundledLocalSidecarDir(app: App, manifest: { dir?: string }): string | null {
  const vaultBasePath = getVaultBasePath(app);
  const pluginDir = manifest.dir?.trim();
  if (!vaultBasePath || !pluginDir) {
    return null;
  }
  try {
    const pathModule = requireNodeModule<PathModule>("path");
    const fsModule = requireNodeModule<FsModule>("fs");
    const pluginPath = pathModule.join(vaultBasePath, pluginDir);
    const sidecarDir = pathModule.join(pluginPath, "sidecar");
    const launcherPath = pathModule.join(sidecarDir, "start-local-server.mjs");
    const serverPath = pathModule.join(sidecarDir, "vault-mcp-local-server.mjs");
    return fsModule.existsSync(launcherPath) && fsModule.existsSync(serverPath) ? sidecarDir : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectLocalServerPort(settings: VaultMcpPluginSettings, expectedVersion: string): Promise<LocalPortSelection> {
  const candidates = localServerPortCandidates(settings.localServerPort);
  let lastOccupiedReason: string | null = null;
  for (const port of candidates) {
    const candidateSettings = { ...settings, localServerPort: port };
    const portOpen = await isLocalTcpPortOpen(port);
    if (!portOpen) {
      const preferredPort = candidates[0];
      return {
        port,
        reused: false,
        health: null,
        message: port === preferredPort
          ? `Local server port ${port} is available.`
          : `Local server port ${preferredPort} is occupied; selected available port ${port}.`,
      };
    }

    try {
      const health = await fetchLocalServerHealth(candidateSettings);
      const compatibility = validateLocalServerCompatibility(health, expectedVersion, localServerEndpoint(candidateSettings));
      if (compatibility.ok) {
        return {
          port,
          reused: true,
          health,
          message: `Reusing compatible local server on ${localServerEndpoint(candidateSettings)}.`,
        };
      }
      lastOccupiedReason = `port ${port}: ${compatibility.message}`;
    } catch (error) {
      lastOccupiedReason = `port ${port}: ${describeCaughtError("local server port check", error)}`;
    }
  }

  throw new Error(`No local server port was available from ${candidates[0]} to ${candidates[candidates.length - 1]}. ${lastOccupiedReason ?? ""}`.trim());
}

async function waitForLocalServerHealth(settings: VaultMcpPluginSettings, expectedVersion: string, timeoutMs = 6000): Promise<PluginServerHealthSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "Local server did not answer /healthz yet.";
  while (Date.now() < deadline) {
    try {
      const health = await fetchLocalServerHealth(settings);
      const compatibility = validateLocalServerCompatibility(health, expectedVersion, localServerEndpoint(settings));
      if (!compatibility.ok) {
        throw new Error(compatibility.message);
      }
      return health;
    } catch (error) {
      lastError = describeCaughtError("local server health check", error);
    }
    await delay(250);
  }
  throw new Error(`Local server did not become healthy and compatible at ${localServerHealthUrl(settings)} within ${timeoutMs}ms. ${lastError}`);
}

async function fetchLocalServerHealth(settings: VaultMcpPluginSettings): Promise<PluginServerHealthSnapshot> {
  const response = await requestUrl({
    url: localServerHealthUrl(settings),
    method: "GET",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(describeHttpFailure("local server health check", response.status, response.text));
  }
  return parseJsonResponse<PluginServerHealthSnapshot>(response.text, "local server health");
}

async function callLocalMcpTool(
  settings: VaultMcpPluginSettings,
  toolName: string,
  toolArguments: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callLocalMcpRequest(settings, "tools/call", {
    name: toolName,
    arguments: toolArguments,
  });
}

async function listLocalMcpTools(settings: VaultMcpPluginSettings): Promise<LocalAgentToolDefinition[]> {
  const response = await callLocalMcpRequest(settings, "tools/list", {});
  const result = isObjectRecord(response.result) ? response.result : null;
  const tools = result && Array.isArray(result.tools) ? result.tools : [];
  return tools.flatMap((entry): LocalAgentToolDefinition[] => {
    if (!isObjectRecord(entry) || typeof entry.name !== "string" || !entry.name.startsWith("local_")) {
      return [];
    }
    const annotations = isObjectRecord(entry.annotations) ? entry.annotations : {};
    return [{
      name: entry.name as LocalAgentToolDefinition["name"],
      description: typeof entry.description === "string" ? entry.description.slice(0, 2_000) : "",
      input_schema: isObjectRecord(entry.inputSchema) ? entry.inputSchema : {},
      read_only: annotations.readOnlyHint === true,
      destructive: annotations.destructiveHint === true,
    }];
  });
}

async function callLocalMcpRequest(
  settings: VaultMcpPluginSettings,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await requestUrl({
    url: localServerEndpoint(settings),
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.localServerMcpToken}`,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(describeHttpFailure(`local MCP ${method}`, response.status, response.text));
  }
  const parsed = parseJsonResponse<Record<string, unknown>>(response.text, `local MCP ${method}`);
  if (isObjectRecord(parsed.error)) {
    throw new Error(typeof parsed.error.message === "string" ? parsed.error.message : `Local MCP ${method} returned a JSON-RPC error.`);
  }
  return parsed;
}

function localFsPolicyFromMcpResponse(response: Record<string, unknown>): LocalFsPolicy {
  const result = isObjectRecord(response.result) ? response.result : null;
  const policy = result && isObjectRecord(result.structuredContent) ? result.structuredContent : null;
  if (!policy || !isLocalFsPolicySnapshot(policy)) {
    throw new Error("Local MCP policy response was missing or invalid.");
  }
  return policy;
}

function localFsPolicyFromPluginSettings(settings: VaultMcpPluginSettings, startedAt: string | null): LocalFsPolicy {
  const expiresAt = settings.localFsAccessTtlMinutes > 0 && startedAt
    ? new Date(Date.parse(startedAt) + settings.localFsAccessTtlMinutes * 60_000).toISOString()
    : null;
  return {
    mode: settings.localFsAccessMode,
    read_roots: [...settings.localFsReadRoots],
    write_roots: [...settings.localFsWriteRoots],
    write_operations: [...settings.localFsWriteOperations],
    max_read_bytes: settings.localFsMaxReadBytes,
    max_search_results: settings.localFsMaxSearchResults,
    max_search_files: settings.localFsMaxSearchFiles,
    expires_at: expiresAt,
    require_user_intent: settings.localFsRequireUserIntent,
    user_intent_phrase: settings.localFsUserIntentPhrase,
  };
}

function isLocalFsPolicySnapshot(value: Record<string, unknown>): value is LocalFsPolicy {
  return ["off", "read", "write", "god"].includes(String(value.mode))
    && isStringList(value.read_roots)
    && isStringList(value.write_roots)
    && isStringList(value.write_operations)
    && isPositiveInteger(value.max_read_bytes)
    && isPositiveInteger(value.max_search_results)
    && isPositiveInteger(value.max_search_files)
    && (value.expires_at === null || typeof value.expires_at === "string")
    && typeof value.require_user_intent === "boolean"
    && typeof value.user_intent_phrase === "string";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function isLocalTcpPortOpen(port: number, timeoutMs = 250): Promise<boolean> {
  try {
    const net = requireNodeModule<NetModule>("net");
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const finish = (open: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(open);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(timeoutMs, () => finish(false));
    });
  } catch {
    return false;
  }
}

function localServerSpawnEnv(config: LocalServerSpawnConfig): Record<string, string | undefined> {
  const baseEnv = { ...getNodeProcessEnv() };
  const commandDir = executableDirectory(config.command);
  if (!commandDir) {
    return baseEnv;
  }
  const pathKey = baseEnv.Path !== undefined ? "Path" : "PATH";
  const currentPath = baseEnv[pathKey] ?? "";
  baseEnv[pathKey] = currentPath ? `${commandDir}:${currentPath}` : commandDir;
  return baseEnv;
}

function executableDirectory(command: string): string | null {
  const trimmed = command.trim();
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex <= 0) {
    return null;
  }
  return trimmed.slice(0, slashIndex);
}

function getNodeProcessEnv(): Record<string, string | undefined> {
  const maybeProcess = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env ?? {};
}

function requireNodeModule<T>(name: string): T {
  const maybeWindow = window as Window & { require?: (moduleName: string) => unknown };
  const maybeGlobal = globalThis as typeof globalThis & { require?: (moduleName: string) => unknown };
  const requireFn = maybeWindow.require ?? maybeGlobal.require;
  if (!requireFn) {
    throw new Error("Obsidian desktop Node runtime is unavailable. Local server launch only works in the desktop app.");
  }
  return requireFn(name) as T;
}

function localServerEndpoint(settings: VaultMcpPluginSettings): string {
  return `http://127.0.0.1:${settings.localServerPort}/mcp`;
}

function localServerHealthUrl(settings: VaultMcpPluginSettings): string {
  return `http://127.0.0.1:${settings.localServerPort}/healthz`;
}

function openExternalUrl(value: string) {
  if (!value) {
    new Notice("Vault MCP: setup guide URL is not ready.");
    return;
  }
  window.open(value, "_blank", "noopener,noreferrer");
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
