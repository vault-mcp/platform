import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("server config", () => {
  it("keeps hosted desktop access disabled by default", () => {
    const config = loadConfig({
      MCP_ACCESS_TOKEN: "access",
      MCP_SYNC_TOKEN: "sync",
    });

    expect(config.remoteLocalFsEnabled).toBe(false);
    expect(config.remoteLocalFsRequestTtlSeconds).toBe(45);
    expect(config.remoteLocalFsWaitSeconds).toBe(25);
    expect(config.remoteLocalFsAgentFreshSeconds).toBe(10);
  });

  it("accepts comma or whitespace separated OAuth capabilities", () => {
    const config = loadConfig({
      MCP_SYNC_TOKEN: "sync",
      OAUTH_ISSUER: "https://vault.example.com",
      OAUTH_AUDIENCE: "https://vault.example.com/mcp",
      OAUTH_AUTHORIZATION_SERVER: "https://vault.example.com",
      OAUTH_JWT_SECRET: "test-secret",
      OAUTH_SCOPES: "vault:read, vault:write local:access",
      MCP_REMOTE_LOCAL_FS_ENABLED: "true",
      MCP_REMOTE_LOCAL_FS_REQUEST_TTL_SECONDS: "30",
      MCP_REMOTE_LOCAL_FS_WAIT_SECONDS: "20",
      MCP_REMOTE_LOCAL_FS_AGENT_FRESH_SECONDS: "8",
    });

    expect(config.oauth?.scopes).toEqual(["vault:read", "vault:write", "local:access"]);
    expect(config.remoteLocalFsEnabled).toBe(true);
    expect(config.remoteLocalFsRequestTtlSeconds).toBe(30);
    expect(config.remoteLocalFsWaitSeconds).toBe(20);
    expect(config.remoteLocalFsAgentFreshSeconds).toBe(8);
  });
});
