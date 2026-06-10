import fs from "node:fs/promises";
import path from "node:path";
import { chunkMarkdown, parseMarkdownNote } from "./markdown.js";
import { evaluateSourcePolicy } from "./source-policy.js";
import { sha256, shortStableId } from "./hash.js";
import { obsidianUri, privateNoteUrl, relativeVaultPath } from "./paths.js";
import { redactSensitiveContent } from "./redaction.js";
import type { IndexStats, VaultDocument, VaultIndex } from "./types.js";

export type BuildVaultIndexOptions = {
  vaultRoot: string;
  vaultName?: string;
  publicBaseUrl?: string;
  now?: Date;
  reportPath?: string;
};

export async function buildVaultIndex(options: BuildVaultIndexOptions): Promise<VaultIndex> {
  const vaultRoot = path.resolve(options.vaultRoot);
  const vaultName = options.vaultName ?? path.basename(vaultRoot);
  const publicBaseUrl = options.publicBaseUrl ?? "https://vault-mcp.local";
  const now = options.now ?? new Date();
  const markdownFiles = await listMarkdownFiles(vaultRoot);
  const documents: VaultDocument[] = [];
  const stats: IndexStats = {
    scanned_markdown: markdownFiles.length,
    allowed_documents: 0,
    denied_markdown: 0,
    denied_by_rule: {},
    redacted_documents: 0,
    redactions_by_pattern: {},
  };

  for (const filePath of markdownFiles) {
    const relativePath = relativeVaultPath(vaultRoot, filePath);
    const pathOnlyPolicy = evaluateSourcePolicy(relativePath, [], null);
    if (isPathOnlyDeny(pathOnlyPolicy.matchedRule)) {
      recordDenied(stats, pathOnlyPolicy.matchedRule);
      continue;
    }

    const markdown = await fs.readFile(filePath, "utf8");
    const redacted = redactSensitiveContent(markdown);
    if (redacted.redactionCount > 0) {
      stats.redacted_documents = (stats.redacted_documents ?? 0) + 1;
      for (const [pattern, count] of Object.entries(redacted.redactionsByPattern)) {
        stats.redactions_by_pattern![pattern] = (stats.redactions_by_pattern![pattern] ?? 0) + count;
      }
    }

    const parsed = safeParseMarkdown(redacted.text, relativePath);
    if (!parsed) {
      recordDenied(stats, "frontmatter-error");
      continue;
    }

    const policy = evaluateSourcePolicy(relativePath, parsed.tags, parsed.status);

    if (!policy.allowed) {
      recordDenied(stats, policy.matchedRule);
      continue;
    }

    const fileStat = await fs.stat(filePath);
    const contentHash = sha256(redacted.text);
    const chunks = chunkMarkdown(parsed);

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const id = shortStableId(`${relativePath}#${chunk.heading ?? "note"}#${chunkIndex}`);
      documents.push({
        id,
        title: chunk.heading ? `${parsed.title} - ${chunk.heading}` : parsed.title,
        text: chunk.text,
        url: privateNoteUrl(publicBaseUrl, id),
        metadata: {
          path: relativePath,
          heading: chunk.heading,
          note_title: parsed.title,
          chunk_index: chunkIndex,
          tags: parsed.tags,
          status: parsed.status,
          updated_at: fileStat.mtime.toISOString(),
          content_hash: contentHash,
          obsidian_uri: obsidianUri(vaultName, relativePath),
          source_policy: {
            allowed: true,
            reason: policy.reason,
            matched_rule: policy.matchedRule,
          },
        },
      });
    }
  }

  stats.allowed_documents = documents.length;

  const index = {
    generated_at: now.toISOString(),
    vault_root: vaultRoot,
    documents,
    stats,
  };

  if (options.reportPath) {
    await writeIndexReport(options.reportPath, index);
  }

  return index;
}

function isPathOnlyDeny(rule: string): boolean {
  return ["deny-exact", "deny-prefix", "non-markdown"].includes(rule);
}

function safeParseMarkdown(markdown: string, relativePath: string): ReturnType<typeof parseMarkdownNote> | null {
  try {
    return parseMarkdownNote(markdown, relativePath);
  } catch {
    return null;
  }
}

function recordDenied(stats: IndexStats, rule: string): void {
  stats.denied_markdown += 1;
  stats.denied_by_rule[rule] = (stats.denied_by_rule[rule] ?? 0) + 1;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function writeIndexReport(reportPath: string, index: VaultIndex): Promise<void> {
  const outputPath = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(index.vault_root, reportPath);
  const notePaths = new Set(index.documents.map((document) => document.metadata.path));
  const report = [
    "# Vault MCP Index Report",
    "",
    "## Summary",
    "",
    `- Indexed notes: ${notePaths.size}`,
    `- Indexed sections: ${index.documents.length}`,
    `- Last indexed: ${index.generated_at}`,
    "- Index version: vault-mcp-index-v2",
    "",
    "## Included Scopes",
    "",
    "- 00 System/Task Hub.md",
    "- 20 Projects/",
    "- 40 Reference/",
    "",
    "## Excluded Scopes",
    "",
    "- 02 Daily/",
    "- Daily Notes/",
    "- 50 Areas/Finance/",
    "- 50 Areas/Identity/",
    "- 50 Areas/Legal/",
    "- 00 System/Credentials/",
    "- Credentials/",
    "- 90 Archive/",
    "",
    "## Skipped Notes",
    "",
    ...Object.entries(index.stats.denied_by_rule).sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => `- ${rule}: ${count}`),
    "",
    "## Warnings",
    "",
    `- Notes with credential-like strings redacted before indexing: ${index.stats.redacted_documents ?? 0}`,
    ...Object.entries(index.stats.redactions_by_pattern ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([pattern, count]) => `- Redactions for ${pattern}: ${count}`),
    "- Notes skipped due to denylist rules are reported by count only.",
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, report, "utf8");
}
