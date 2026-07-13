import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readPluginManifestVersion(repoRoot) {
  const manifestPath = path.join(repoRoot, "apps", "obsidian-plugin", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new Error(`Obsidian plugin manifest is missing a version: ${manifestPath}`);
  }
  return manifest.version;
}
