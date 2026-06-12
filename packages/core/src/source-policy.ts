import type { IndexPolicy, IndexPolicyRule, SourcePolicyDecision } from "./types.js";

export const DEFAULT_TENANT_ID = "default";
export const DEFAULT_VAULT_ID = "default";
export const DEFAULT_INSTALLATION_ID = "local";
export const DEFAULT_POLICY_VERSION = "vault-mcp-policy-v2";

const DENY_PREFIXES = [
  "00 System/Credentials/",
  "02 Daily/",
  "Daily Notes/",
  "Credentials/",
  "50 Areas/Finance/",
  "50 Areas/Identity/",
  "50 Areas/Legal/",
  "50 Areas/Vehicles/",
  "50 Areas/Faith/",
  "90 Archive/",
];

const DENY_EXACT = new Set([
  "00 System/Needs Review.md",
]);

const DENY_TAG_PARTS = [
  "sensitive",
  "credential",
  "credentials",
  "finance",
  "financial",
  "legal",
  "identity",
  "review",
  "excalidraw",
];

const ALLOW_REFERENCE_EXACT = new Set([
  "40 Reference/Reference Home.md",
]);

const ALLOW_REFERENCE_PREFIXES = [
  "40 Reference/CSS/",
  "40 Reference/Chrome Extensions/",
  "40 Reference/Cloudflare/",
  "40 Reference/Developer Setup/",
  "40 Reference/Documentation/",
  "40 Reference/GIMP/",
  "40 Reference/HTML/",
  "40 Reference/JavaScript/",
  "40 Reference/Local AI/",
  "40 Reference/Markdown/",
  "40 Reference/OCR/",
  "40 Reference/Obsidian/",
  "40 Reference/Regex/",
  "40 Reference/Recipes/",
  "40 Reference/Self Hosting/",
  "40 Reference/Terminal/",
  "40 Reference/Web Design/",
  "40 Reference/WordPress/",
];

export function defaultIndexPolicy(mode: IndexPolicy["mode"] = "rules_plus_approvals"): IndexPolicy {
  return {
    version: DEFAULT_POLICY_VERSION,
    mode,
    rules: [
      ...DENY_PREFIXES.map((prefix): IndexPolicyRule => ({
        id: `deny-prefix:${prefix}`,
        action: "deny",
        kind: "path_prefix",
        value: prefix,
        reason: `Denied path prefix: ${prefix}`,
      })),
      ...[...DENY_EXACT].map((exact): IndexPolicyRule => ({
        id: `deny-exact:${exact}`,
        action: "deny",
        kind: "path_exact",
        value: exact,
        reason: `Denied exact sensitive/review-gated path: ${exact}`,
      })),
      ...DENY_TAG_PARTS.map((tag): IndexPolicyRule => ({
        id: `deny-tag:${tag}`,
        action: "deny",
        kind: "tag",
        value: tag,
        reason: `Denied tag containing: ${tag}`,
      })),
      {
        id: "allow-task-hub",
        action: "allow",
        kind: "path_exact",
        value: "00 System/Task Hub.md",
        reason: "Allowed system task hub.",
      },
      {
        id: "allow-active-project-home",
        action: "allow",
        kind: "path_prefix",
        value: "20 Projects/",
        reason: "Allowed active project home.",
      },
      ...[...ALLOW_REFERENCE_EXACT].map((exact): IndexPolicyRule => ({
        id: `allow-reference-exact:${exact}`,
        action: "allow",
        kind: "path_exact",
        value: exact,
        reason: "Allowed selected reference note.",
      })),
      ...ALLOW_REFERENCE_PREFIXES.map((prefix): IndexPolicyRule => ({
        id: `allow-reference-prefix:${prefix}`,
        action: "allow",
        kind: "path_prefix",
        value: prefix,
        reason: "Allowed selected reference note.",
      })),
    ],
  };
}

export function summarizeIndexPolicy(policy: IndexPolicy) {
  return {
    allowed_rules: policy.rules.filter((rule) => rule.action === "allow").map((rule) => rule.id),
    denied_rules: policy.rules.filter((rule) => rule.action === "deny").map((rule) => rule.id),
    review_rules: policy.rules.filter((rule) => rule.action === "review").map((rule) => rule.id),
  };
}

export function evaluateSourcePolicy(relativePath: string, tags: string[], status: string | null, policy = defaultIndexPolicy()): SourcePolicyDecision {
  if (!relativePath.endsWith(".md")) {
    return deny("non-markdown", "Only Markdown notes are indexed.");
  }

  const denyRule = policy.rules.find((rule) => rule.action === "deny" && ruleMatches(rule, relativePath, tags, status));
  if (denyRule) {
    return deny(normalizeRuleId(denyRule), denyRule.reason);
  }

  if (status && ["review", "needs-review", "sensitive"].includes(status.toLowerCase())) {
    return deny("deny-status", `Denied status: ${status}`);
  }

  if (policy.mode === "manual_only" && !isManuallyAllowed(relativePath, policy)) {
    return deny("manual-approval-required", "Manual indexing mode requires this path or prefix to be approved before indexing.");
  }

  const reviewRule = policy.mode === "rules_plus_approvals"
    ? policy.rules.find((rule) => rule.action === "review" && ruleMatches(rule, relativePath, tags, status))
    : undefined;
  if (reviewRule) {
    return {
      allowed: false,
      matchedRule: normalizeRuleId(reviewRule),
      reason: reviewRule.reason,
      reviewRequired: true,
    };
  }

  const allowRule = policy.rules.find((rule) => rule.action === "allow" && ruleMatches(rule, relativePath, tags, status));
  if (allowRule) {
    const normalized = normalizeRuleId(allowRule);
    if (normalized === "allow-active-project-home" && !isActiveProjectHome(relativePath, status)) {
      return deny("not-active-project", "Only active project homes are indexed in V1.");
    }

    return allow(normalized, allowRule.reason);
  }

  if (relativePath === "00 System/Task Hub.md") {
    return allow("allow-task-hub", "Allowed system task hub.");
  }

  if (relativePath.startsWith("20 Projects/") && relativePath.endsWith("/Project Home.md")) {
    if (status?.toLowerCase() !== "active") {
      return deny("not-active-project", "Only active project homes are indexed in V1.");
    }

    return allow("allow-active-project-home", "Allowed project home.");
  }

  if (ALLOW_REFERENCE_EXACT.has(relativePath) || ALLOW_REFERENCE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return allow("allow-selected-reference", "Allowed selected reference note.");
  }

  if (relativePath.startsWith("40 Reference/")) {
    return deny("reference-not-selected", "Reference note is not selected for V1 indexing.");
  }

  return deny("not-allowlisted", "Path did not match the V1 allowlist.");
}

function ruleMatches(rule: IndexPolicyRule, relativePath: string, tags: string[], status: string | null): boolean {
  if (rule.kind === "path_exact") {
    return relativePath === rule.value;
  }

  if (rule.kind === "path_prefix") {
    return relativePath.startsWith(rule.value);
  }

  if (rule.kind === "tag") {
    return tags.some((tag) => normalizeTag(tag).includes(normalizeTag(rule.value)));
  }

  return (status ?? "").toLowerCase() === rule.value.toLowerCase();
}

function isManuallyAllowed(relativePath: string, policy: IndexPolicy): boolean {
  return (policy.manual_allow_paths ?? []).includes(relativePath)
    || (policy.manual_allow_prefixes ?? []).some((prefix) => relativePath.startsWith(prefix));
}

function isActiveProjectHome(relativePath: string, status: string | null): boolean {
  return relativePath.startsWith("20 Projects/")
    && relativePath.endsWith("/Project Home.md")
    && status?.toLowerCase() === "active";
}

function normalizeRuleId(rule: IndexPolicyRule): string {
  if (rule.id.startsWith("deny-prefix:")) {
    return "deny-prefix";
  }
  if (rule.id.startsWith("deny-exact:")) {
    return "deny-exact";
  }
  if (rule.id.startsWith("deny-tag:")) {
    return "deny-tag";
  }
  if (rule.id.startsWith("allow-reference-")) {
    return "allow-selected-reference";
  }
  return rule.id;
}

function allow(matchedRule: string, reason: string): SourcePolicyDecision {
  return { allowed: true, matchedRule, reason };
}

function deny(matchedRule: string, reason: string): SourcePolicyDecision {
  return { allowed: false, matchedRule, reason };
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}
