import type { SourcePolicyDecision } from "./types.js";

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

export function evaluateSourcePolicy(relativePath: string, tags: string[], status: string | null): SourcePolicyDecision {
  if (!relativePath.endsWith(".md")) {
    return deny("non-markdown", "Only Markdown notes are indexed.");
  }

  if (DENY_EXACT.has(relativePath)) {
    return deny("deny-exact", `Denied exact sensitive/review-gated path: ${relativePath}`);
  }

  const deniedPrefix = DENY_PREFIXES.find((prefix) => relativePath.startsWith(prefix));
  if (deniedPrefix) {
    return deny("deny-prefix", `Denied path prefix: ${deniedPrefix}`);
  }

  const deniedTag = tags.find((tag) => DENY_TAG_PARTS.some((part) => normalizeTag(tag).includes(part)));
  if (deniedTag) {
    return deny("deny-tag", `Denied tag: ${deniedTag}`);
  }

  if (status && ["review", "needs-review", "sensitive"].includes(status.toLowerCase())) {
    return deny("deny-status", `Denied status: ${status}`);
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

function allow(matchedRule: string, reason: string): SourcePolicyDecision {
  return { allowed: true, matchedRule, reason };
}

function deny(matchedRule: string, reason: string): SourcePolicyDecision {
  return { allowed: false, matchedRule, reason };
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}
