import path from "node:path";
import YAML from "yaml";

export type ParsedMarkdownNote = {
  frontmatter: Record<string, unknown>;
  body: string;
  title: string;
  tags: string[];
  status: string | null;
  headings: string[];
  wikilinks: string[];
  tasks: string[];
};

export function parseMarkdownNote(markdown: string, relativePath: string): ParsedMarkdownNote {
  const parsed = parseFrontmatter(markdown);
  const body = parsed.body.trim();
  const frontmatter = parsed.frontmatter;
  const title = extractTitle(body, relativePath);
  const tags = extractTags(frontmatter, body);
  const status = typeof frontmatter.status === "string" ? frontmatter.status : null;

  return {
    frontmatter,
    body,
    title,
    tags,
    status,
    headings: extractHeadings(body),
    wikilinks: extractWikilinks(body),
    tasks: extractTasks(body),
  };
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const parsed = YAML.parse(match[1]) as unknown;
  const frontmatter = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return {
    frontmatter,
    body: markdown.slice(match[0].length),
  };
}

export function chunkMarkdown(parsed: ParsedMarkdownNote, maxChars = 4_000): Array<{ heading: string | null; text: string }> {
  const sections = splitIntoHeadingSections(parsed.body);
  const chunks: Array<{ heading: string | null; text: string }> = [];

  for (const section of sections) {
    if (section.text.length <= maxChars) {
      chunks.push(section);
      continue;
    }

    for (let start = 0; start < section.text.length; start += maxChars) {
      chunks.push({
        heading: section.heading,
        text: section.text.slice(start, start + maxChars).trim(),
      });
    }
  }

  return chunks.filter((chunk) => chunk.text.length > 0);
}

function extractTitle(body: string, relativePath: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  return path.basename(relativePath, ".md");
}

function extractTags(frontmatter: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();
  const rawTags = frontmatter.tags;

  if (Array.isArray(rawTags)) {
    for (const tag of rawTags) {
      if (typeof tag === "string") {
        tags.add(normalizeTag(tag));
      }
    }
  } else if (typeof rawTags === "string") {
    for (const tag of rawTags.split(/[,\s]+/)) {
      if (tag.trim()) {
        tags.add(normalizeTag(tag));
      }
    }
  }

  for (const match of body.matchAll(/(?:^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]*)/g)) {
    tags.add(match[1]);
  }

  return [...tags].sort();
}

function extractHeadings(body: string): string[] {
  return [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
}

function extractWikilinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim());
}

function extractTasks(body: string): string[] {
  return [...body.matchAll(/^\s*-\s+\[[ xX/-]\]\s+(.+)$/gm)].map((match) => match[1].trim());
}

function splitIntoHeadingSections(body: string): Array<{ heading: string | null; text: string }> {
  const lines = body.split(/\r?\n/);
  const sections: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading && current.lines.length > 0) {
      sections.push(current);
      current = { heading: heading[2].trim(), lines: [line] };
    } else {
      if (heading) {
        current.heading = heading[2].trim();
      }
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  return sections.map((section) => ({
    heading: section.heading,
    text: section.lines.join("\n").trim(),
  }));
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, "");
}
