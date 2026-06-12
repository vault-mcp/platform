import { describe, expect, it } from "vitest";
import { defaultIndexPolicy, evaluateSourcePolicy } from "./source-policy.js";

describe("evaluateSourcePolicy", () => {
  it("allows active project homes", () => {
    const decision = evaluateSourcePolicy("20 Projects/Vault MCP Connector/Project Home.md", ["type/project"], "active");

    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBe("allow-active-project-home");
  });

  it("denies paused or archived project homes", () => {
    const decision = evaluateSourcePolicy("20 Projects/NAS Server/Project Home.md", ["type/project"], "paused");

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("not-active-project");
  });

  it("allows reference notes", () => {
    const decision = evaluateSourcePolicy("40 Reference/JavaScript/Node File System Notes.md", ["type/reference"], "active");

    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBe("allow-selected-reference");
  });

  it("denies reference notes outside selected V1 prefixes", () => {
    const decision = evaluateSourcePolicy("40 Reference/Business Development/Upwork Proposal Workflow.md", ["type/reference"], "active");

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("reference-not-selected");
  });

  it("denies AI prompt reference notes unless explicitly selected", () => {
    const decision = evaluateSourcePolicy("40 Reference/AI Prompts/Podcast Strategy Pack Prompt.md", ["type/reference"], "active");

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("reference-not-selected");
  });

  it("denies daily notes even when they have ordinary tags", () => {
    const decision = evaluateSourcePolicy("02 Daily/2026-06-07.md", ["type/daily"], "active");

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("deny-prefix");
  });

  it("denies review-gated and credential paths", () => {
    expect(evaluateSourcePolicy("00 System/Needs Review.md", [], "active").allowed).toBe(false);
    expect(evaluateSourcePolicy("00 System/Credentials/Credential Index.md", [], "active").allowed).toBe(false);
  });

  it("denies sensitive tags before allowlist matches", () => {
    const decision = evaluateSourcePolicy("40 Reference/Sensitive Thing.md", ["topic/security", "sensitive"], "active");

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("deny-tag");
  });

  it("denies Excalidraw wrappers in reference folders", () => {
    const decision = evaluateSourcePolicy("40 Reference/AI SDK/Diagram.excalidraw.md", ["excalidraw"], null);

    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("deny-tag");
  });

  it("supports manual-only indexing with explicit approved paths", () => {
    const policy = {
      ...defaultIndexPolicy("manual_only"),
      manual_allow_paths: ["40 Reference/Obsidian/Test Reference.md"],
    };

    expect(evaluateSourcePolicy("40 Reference/Obsidian/Test Reference.md", ["type/reference"], "active", policy).allowed).toBe(true);

    const unapproved = evaluateSourcePolicy("40 Reference/JavaScript/Node.md", ["type/reference"], "active", policy);
    expect(unapproved.allowed).toBe(false);
    expect(unapproved.matchedRule).toBe("manual-approval-required");
  });

  it("routes review rules to the approval queue in rules-plus-approvals mode", () => {
    const policy = {
      ...defaultIndexPolicy("rules_plus_approvals"),
      rules: [
        {
          id: "review-ai-notes",
          action: "review" as const,
          kind: "path_prefix" as const,
          value: "40 Reference/AI/",
          reason: "Review AI notes before syncing.",
        },
        ...defaultIndexPolicy().rules,
      ],
    };

    const decision = evaluateSourcePolicy("40 Reference/AI/Prompt.md", ["type/reference"], "active", policy);
    expect(decision.allowed).toBe(false);
    expect(decision.reviewRequired).toBe(true);
    expect(decision.matchedRule).toBe("review-ai-notes");
  });
});
