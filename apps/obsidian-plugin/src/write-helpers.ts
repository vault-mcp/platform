import type { WriteProposal } from "@vault-mcp/core";

export type FrontmatterPatch = Record<string, string | number | boolean | null | string[] | number[] | boolean[]>;

export type ProposalSafetyAnalysis = {
  targetExists: boolean;
  currentHash: string | null;
  baseHashMatches: boolean | null;
  canApplyInFuture: boolean;
  status: "ready" | "conflict" | "missing-target" | "existing-target" | "unsupported";
  message: string;
  diffPreview: string | null;
};

export type LocalApplyResult = {
  backupPath: string;
  auditPath: string;
  newHash: string;
};

type AuditDraft = {
  backupPath: string;
  auditPath: string;
};

export type WriteApplyAdapter<FileRef> = {
  writeAuditFolder: string;
  getFile(path: string): FileRef | null;
  readFile(file: FileRef): Promise<string>;
  createFile(path: string, content: string): Promise<void>;
  processFile(file: FileRef, updater: (content: string) => string): Promise<void>;
  processFrontmatter(file: FileRef, updater: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  renameFile(file: FileRef, newPath: string): Promise<void>;
  ensureFolder(folder: string): Promise<void>;
  now?(): Date;
};

export async function analyzeWriteProposalWithAdapter<FileRef>(proposal: WriteProposal, adapter: WriteApplyAdapter<FileRef>): Promise<ProposalSafetyAnalysis> {
  const target = adapter.getFile(proposal.target_path);
  const targetExists = target !== null;
  const currentContent = target ? await adapter.readFile(target) : null;
  const currentHash = currentContent === null ? null : await sha256Hex(currentContent);
  const baseHashMatches = proposal.base_content_hash === null ? null : currentHash === proposal.base_content_hash;

  if (proposal.operation === "create_note") {
    if (targetExists) {
      return {
        targetExists,
        currentHash,
        baseHashMatches,
        canApplyInFuture: false,
        status: "existing-target",
        message: "Create-note proposal targets a file that already exists. This must be reviewed as a conflict.",
        diffPreview: buildDiffPreview("", proposal.proposed_content ?? ""),
      };
    }
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: Boolean(proposal.proposed_content),
      status: proposal.proposed_content ? "ready" : "unsupported",
      message: proposal.proposed_content ? "Ready for future create-note application." : "Create-note proposal has no proposed content.",
      diffPreview: buildDiffPreview("", proposal.proposed_content ?? ""),
    };
  }

  if (!targetExists) {
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: false,
      status: "missing-target",
      message: "Target file does not exist locally. This must be reviewed before any apply step.",
      diffPreview: null,
    };
  }

  if (proposal.base_content_hash && !baseHashMatches) {
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: false,
      status: "conflict",
      message: "Local file hash does not match the proposal base hash. Do not apply automatically.",
      diffPreview: previewForProposal(proposal, currentContent ?? ""),
    };
  }

  if (proposal.operation === "append_to_note" || proposal.operation === "replace_note") {
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: Boolean(proposal.proposed_content),
      status: proposal.proposed_content ? "ready" : "unsupported",
      message: proposal.proposed_content ? "Base hash is compatible for future local apply." : "Proposal has no proposed content to preview.",
      diffPreview: previewForProposal(proposal, currentContent ?? ""),
    };
  }

  if (proposal.operation === "rename_note") {
    const newPath = renameTargetPath(proposal);
    const newPathExists = newPath ? adapter.getFile(newPath) !== null : false;
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: Boolean(newPath && !newPathExists),
      status: newPath && !newPathExists ? "ready" : "unsupported",
      message: newPath
        ? newPathExists
          ? "Rename target already exists. Choose a different target path before applying."
          : "Base hash is compatible for future rename."
        : "Rename proposal must provide the new path in proposed_content.",
      diffPreview: newPath ? buildDiffPreview(proposal.target_path, newPath) : null,
    };
  }

  if (proposal.operation === "update_frontmatter") {
    const patch = parseFrontmatterPatch(proposal);
    return {
      targetExists,
      currentHash,
      baseHashMatches,
      canApplyInFuture: Boolean(patch),
      status: patch ? "ready" : "unsupported",
      message: patch ? "Base hash is compatible for future frontmatter update." : "Frontmatter proposal must provide a JSON object in proposed_content.",
      diffPreview: patch ? frontmatterPatchPreview(patch) : null,
    };
  }

  return {
    targetExists,
    currentHash,
    baseHashMatches,
    canApplyInFuture: false,
    status: "unsupported",
    message: "This operation needs a dedicated diff/apply implementation before it can be safely applied.",
    diffPreview: previewForProposal(proposal, currentContent ?? ""),
  };
}

export async function applyWriteProposalWithAdapter<FileRef>(proposal: WriteProposal, adapter: WriteApplyAdapter<FileRef>): Promise<LocalApplyResult> {
  const analysis = await analyzeWriteProposalWithAdapter(proposal, adapter);
  if (!analysis.canApplyInFuture) {
    throw new Error(`Proposal is not safe to apply: ${analysis.message}`);
  }

  const beforeFile = adapter.getFile(proposal.target_path);
  const beforeContent = beforeFile ? await adapter.readFile(beforeFile) : "";
  const afterContent = contentAfterProposal(proposal, beforeContent);

  const currentHash = beforeFile ? await sha256Hex(beforeContent) : null;
  if (proposal.base_content_hash && currentHash !== proposal.base_content_hash) {
    throw new Error("Local file hash changed before apply. Refresh proposals and review conflict.");
  }

  const audit = await createProposalBackupAndAuditDraft(proposal, beforeContent, currentHash, adapter);

  if (proposal.operation === "create_note" && afterContent !== null) {
    if (beforeFile) {
      throw new Error("Cannot create note because target already exists.");
    }
    await adapter.ensureFolder(parentPrefix(proposal.target_path).replace(/\/$/, ""));
    await adapter.createFile(proposal.target_path, afterContent);
    const newHash = await sha256Hex(afterContent);
    await finishProposalAudit(audit.auditPath, proposal, beforeContent, afterContent, currentHash, newHash, adapter);
    return {
      backupPath: audit.backupPath,
      auditPath: audit.auditPath,
      newHash,
    };
  }

  if ((proposal.operation === "append_to_note" || proposal.operation === "replace_note") && afterContent !== null) {
    if (!beforeFile) {
      throw new Error("Cannot edit note because target file does not exist.");
    }
    await adapter.processFile(beforeFile, () => afterContent);
    const newHash = await sha256Hex(afterContent);
    await finishProposalAudit(audit.auditPath, proposal, beforeContent, afterContent, currentHash, newHash, adapter);
    return {
      backupPath: audit.backupPath,
      auditPath: audit.auditPath,
      newHash,
    };
  }

  if (proposal.operation === "update_frontmatter") {
    if (!beforeFile) {
      throw new Error("Cannot update frontmatter because target file does not exist.");
    }
    const patch = parseFrontmatterPatch(proposal);
    if (!patch) {
      throw new Error("Frontmatter proposal must provide a JSON object in proposed_content.");
    }
    await adapter.processFrontmatter(beforeFile, (frontmatter) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
          delete frontmatter[key];
        } else {
          frontmatter[key] = value;
        }
      }
    });
    const afterFile = adapter.getFile(proposal.target_path);
    const appliedContent = afterFile ? await adapter.readFile(afterFile) : "";
    const newHash = await sha256Hex(appliedContent);
    await finishProposalAudit(audit.auditPath, proposal, beforeContent, appliedContent, currentHash, newHash, adapter);
    return {
      backupPath: audit.backupPath,
      auditPath: audit.auditPath,
      newHash,
    };
  }

  if (proposal.operation === "rename_note") {
    if (!beforeFile) {
      throw new Error("Cannot rename note because target file does not exist.");
    }
    const newPath = renameTargetPath(proposal);
    if (!newPath) {
      throw new Error("Rename proposal must provide the new path in proposed_content.");
    }
    if (adapter.getFile(newPath)) {
      throw new Error("Cannot rename note because destination already exists.");
    }
    await adapter.ensureFolder(parentPrefix(newPath).replace(/\/$/, ""));
    await adapter.renameFile(beforeFile, newPath);
    const newHash = currentHash ?? await sha256Hex(beforeContent);
    await finishProposalAudit(audit.auditPath, proposal, beforeContent, beforeContent, currentHash, newHash, adapter, newPath);
    return {
      backupPath: audit.backupPath,
      auditPath: audit.auditPath,
      newHash,
    };
  }

  throw new Error(`Unsupported write operation: ${proposal.operation}`);
}

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

function parentPrefix(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}

async function createProposalBackupAndAuditDraft<FileRef>(proposal: WriteProposal, beforeContent: string, beforeHash: string | null, adapter: WriteApplyAdapter<FileRef>): Promise<AuditDraft> {
  const timestamp = (adapter.now?.() ?? new Date()).toISOString();
  const folder = `${adapter.writeAuditFolder.replace(/\/$/, "")}/${timestamp.slice(0, 10)}`;
  await adapter.ensureFolder(folder);
  const safeId = proposal.id.replace(/[^A-Za-z0-9_-]/g, "-");
  const backupPath = `${folder}/${timestamp.replace(/[:.]/g, "-")}-${safeId}-backup.md`;
  const auditPath = `${folder}/${timestamp.replace(/[:.]/g, "-")}-${safeId}-audit.md`;
  await adapter.createFile(backupPath, beforeContent);
  await adapter.createFile(auditPath, [
    "---",
    "type: vault-mcp-write-audit",
    `proposal_id: ${JSON.stringify(proposal.id)}`,
    `target_path: ${JSON.stringify(proposal.target_path)}`,
    `operation: ${JSON.stringify(proposal.operation)}`,
    `status: ${JSON.stringify(proposal.status)}`,
    `created: ${JSON.stringify(timestamp)}`,
    "---",
    "# Vault MCP Write Audit",
    "",
    `- Proposal id: \`${proposal.id}\``,
    `- Target path: \`${proposal.target_path}\``,
    `- Operation: \`${proposal.operation}\``,
    `- Requester: \`${proposal.requester}\``,
    `- Base hash: \`${proposal.base_content_hash ?? "none"}\``,
    `- Local before hash: \`${beforeHash ?? "none"}\``,
    `- Backup path: \`${backupPath}\``,
    "",
    "## Apply Status",
    "",
    "Backup created before local apply. Final result pending.",
  ].join("\n"));
  return { backupPath, auditPath };
}

async function finishProposalAudit<FileRef>(
  auditPath: string,
  proposal: WriteProposal,
  beforeContent: string,
  afterContent: string,
  beforeHash: string | null,
  afterHash: string,
  adapter: WriteApplyAdapter<FileRef>,
  finalTargetPath = proposal.target_path,
) {
  const auditFile = adapter.getFile(auditPath);
  if (!auditFile) {
    throw new Error(`Audit file disappeared before completion: ${auditPath}`);
  }
  await adapter.processFile(auditFile, (existing) => `${existing}

## Apply Result

- Applied at: \`${(adapter.now?.() ?? new Date()).toISOString()}\`
- Final target path: \`${finalTargetPath}\`
- Local before hash: \`${beforeHash ?? "none"}\`
- Local after hash: \`${afterHash}\`

## Diff Preview

\`\`\`diff
${buildDiffPreview(beforeContent, afterContent)}
\`\`\`
`);
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
