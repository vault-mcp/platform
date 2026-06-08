import type { FetchResponse, SearchResponse, SearchResult, VaultDocument } from "./types.js";

export function searchDocuments(documents: VaultDocument[], query: string, limit = 10, scope?: string): SearchResponse {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { results: [] };
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const scopedDocuments = scope
    ? documents.filter((document) => document.metadata.path.startsWith(scope))
    : documents;

  const scored = scopedDocuments
    .map((document) => ({ document, score: scoreDocument(document, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.document.metadata.path.localeCompare(b.document.metadata.path));

  return {
    results: scored.slice(0, Math.max(1, Math.min(limit, 25))).map(({ document }) => toSearchResult(document, terms)),
  };
}

export function fetchDocument(documents: VaultDocument[], id: string): FetchResponse | null {
  return documents.find((document) => document.id === id) ?? null;
}

function scoreDocument(document: VaultDocument, terms: string[]): number {
  const title = document.title.toLowerCase();
  const path = document.metadata.path.toLowerCase();
  const text = document.text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 10;
    }
    if (path.includes(term)) {
      score += 6;
    }
    const textMatches = countOccurrences(text, term);
    score += Math.min(textMatches, 8);
  }

  return score;
}

function toSearchResult(document: VaultDocument, terms: string[]): SearchResult {
  return {
    id: document.id,
    title: document.title,
    url: document.url,
    text_snippet: createSnippet(document.text, terms),
    metadata: document.metadata,
  };
}

function createSnippet(text: string, terms: string[], maxLength = 280): string {
  const lower = text.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstHit - 80);
  const snippet = text.slice(start, start + maxLength).replace(/\s+/g, " ").trim();
  return start > 0 ? `...${snippet}` : snippet;
}

function countOccurrences(text: string, term: string): number {
  if (!term) {
    return 0;
  }

  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}
