import type { WriteProposal } from "@vault-mcp/core";

export type FrontmatterPatch = Record<string, string | number | boolean | null | string[] | number[] | boolean[]>;

export function previewForProposal(proposal: WriteProposal, currentContent: string): string | null {
  if (proposal.proposed_patch) {
    return proposal.proposed_patch;
  }
  if (proposal.operation === "append_to_note" && proposal.proposed_content !== undefined) {
    return buildDiffPreview(currentContent, `${currentContent}${proposal.proposed_content}`);
  }
  if ((proposal.operation === "replace_note" || proposal.operation === "create_note") && proposal.proposed_content !== undefined) {
    return buildDiffPreview(currentContent, proposal.proposed_content);
  }
  return null;
}

export function contentAfterProposal(proposal: WriteProposal, currentContent: string): string | null {
  if (proposal.operation === "append_to_note" && proposal.proposed_content !== undefined) {
    return `${currentContent}${proposal.proposed_content}`;
  }
  if ((proposal.operation === "replace_note" || proposal.operation === "create_note") && proposal.proposed_content !== undefined) {
    return proposal.proposed_content;
  }
  return null;
}

export function renameTargetPath(proposal: WriteProposal): string | null {
  const value = proposal.proposed_content?.trim();
  if (!value || value.includes("\n") || value.startsWith("/") || !value.endsWith(".md") || value.split("/").includes("..")) {
    return null;
  }
  return value;
}

export function parseFrontmatterPatch(proposal: WriteProposal): FrontmatterPatch | null {
  if (!proposal.proposed_content) {
    return null;
  }
  try {
    const parsed = JSON.parse(proposal.proposed_content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return null;
    }
    if (Object.keys(parsed).length === 0) {
      return null;
    }
    for (const value of Object.values(parsed)) {
      if (!isFrontmatterPatchValue(value)) {
        return null;
      }
    }
    return parsed as FrontmatterPatch;
  } catch {
    return null;
  }
}

export function isFrontmatterPatchValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
}

export function frontmatterPatchPreview(patch: FrontmatterPatch): string {
  return Object.entries(patch)
    .map(([key, value]) => value === null ? `- ${key}` : `+ ${key}: ${JSON.stringify(value)}`)
    .join("\n");
}

export function buildDiffPreview(before: string, after: string): string {
  if (before === after) {
    return "No text changes detected.";
  }
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const rows: string[] = [];
  const maxRows = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxRows; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined && shouldKeepContext(rows)) {
        rows.push(`  ${beforeLine}`);
      }
      continue;
    }
    if (beforeLine !== undefined) {
      rows.push(`- ${beforeLine}`);
    }
    if (afterLine !== undefined) {
      rows.push(`+ ${afterLine}`);
    }
  }
  return rows.length > 0 ? rows.join("\n") : "No text changes detected.";
}

function shouldKeepContext(rows: string[]): boolean {
  const previous = rows.at(-1);
  return previous === undefined || previous.startsWith("- ") || previous.startsWith("+ ");
}
