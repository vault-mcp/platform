import fs from "node:fs/promises";
import path from "node:path";
import { chunkMarkdown, parseMarkdownNote } from "./markdown.js";
import { evaluateSourcePolicy } from "./source-policy.js";
import { sha256, shortStableId } from "./hash.js";
import { obsidianUri, privateNoteUrl, relativeVaultPath } from "./paths.js";
import type { IndexStats, VaultDocument, VaultIndex } from "./types.js";

export type BuildVaultIndexOptions = {
  vaultRoot: string;
  vaultName?: string;
  publicBaseUrl?: string;
  now?: Date;
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
  };

  for (const filePath of markdownFiles) {
    const relativePath = relativeVaultPath(vaultRoot, filePath);
    const pathOnlyPolicy = evaluateSourcePolicy(relativePath, [], null);
    if (isPathOnlyDeny(pathOnlyPolicy.matchedRule)) {
      recordDenied(stats, pathOnlyPolicy.matchedRule);
      continue;
    }

    const markdown = await fs.readFile(filePath, "utf8");
    const parsed = safeParseMarkdown(markdown, relativePath);
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
    const contentHash = sha256(markdown);
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

  return {
    generated_at: now.toISOString(),
    vault_root: vaultRoot,
    documents,
    stats,
  };
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
