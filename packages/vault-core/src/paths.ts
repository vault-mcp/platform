import path from "node:path";

export function normalizeVaultPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function relativeVaultPath(vaultRoot: string, absolutePath: string): string {
  return normalizeVaultPath(path.relative(vaultRoot, absolutePath));
}

export function obsidianUri(vaultName: string, relativePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`;
}

export function privateNoteUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/$/, "")}/notes/${encodeURIComponent(id)}`;
}
