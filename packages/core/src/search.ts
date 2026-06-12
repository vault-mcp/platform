import type {
  DebugSearchResponse,
  FetchResponse,
  IndexStats,
  IndexStatusResponse,
  ListNotesOptions,
  ListNotesResponse,
  NoteSummary,
  SearchOptions,
  SearchResponse,
  SearchResult,
  VaultDocument,
} from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const SEARCH_MAX_LIMIT = 25;
const INDEX_VERSION = "vault-mcp-index-v2";
const ALLOWED_SCOPES = [
  "00 System/Task Hub.md",
  "20 Projects/",
  "40 Reference/",
];
const EXCLUDED_SCOPES = [
  "02 Daily/",
  "50 Areas/Finance/",
  "50 Areas/Identity/",
  "50 Areas/Legal/",
  "00 System/Credentials/",
  "90 Archive/",
];
const SYNONYMS: Record<string, string[]> = {
  drink: ["cocktail", "beverage", "recipe", "vodka", "cider"],
  server: ["homelab", "self-hosting", "docker", "cloudflare", "tunnel"],
  car: ["vehicle", "truck", "rv", "tow", "engine"],
  code: ["javascript", "css", "html", "node", "project"],
};

export function searchDocuments(documents: VaultDocument[], query: string, limit = DEFAULT_LIMIT, scope?: string): SearchResponse {
  return searchSections(documents, { query, limit, scope });
}

export function searchNotes(documents: VaultDocument[], options: SearchOptions): SearchResponse {
  const normalizedQuery = normalize(options.query);
  if (!normalizedQuery) {
    return { results: [] };
  }

  const query = expandedQuery(normalizedQuery);
  const notes = groupByNote(documents)
    .map((note) => scoreNote(note, query))
    .filter((item) => item.score > 0 && noteMatchesFilters(item.summary, options))
    .sort((a, b) => b.score - a.score || a.summary.path.localeCompare(b.summary.path));

  return {
    results: notes.slice(0, normalizeSearchLimit(options.limit)).map((item) => toNoteSearchResult(item, query)),
  };
}

export function searchSections(documents: VaultDocument[], options: SearchOptions): SearchResponse {
  const normalizedQuery = normalize(options.query);
  if (!normalizedQuery) {
    return { results: [] };
  }

  const query = expandedQuery(normalizedQuery);
  const scored = documents
    .filter((document) => documentMatchesFilters(document, options))
    .map((document) => ({ document, ...scoreDocument(document, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.document.metadata.path.localeCompare(b.document.metadata.path));

  return {
    results: scored.slice(0, normalizeSearchLimit(options.limit)).map((item) => toSectionSearchResult(item.document, query, item.score, item.reasons)),
  };
}

export function searchVault(documents: VaultDocument[], options: SearchOptions): SearchResponse {
  return options.mode === "notes"
    ? searchNotes(documents, options)
    : searchSections(documents, options);
}

export function fetchDocument(documents: VaultDocument[], id: string, vaultId?: string): FetchResponse | null {
  const document = documents.find((item) => item.id === id && documentMatchesVault(item, vaultId));
  return document ? withTopLevelObsidianUri(document) : null;
}

export function fetchDocumentByPath(documents: VaultDocument[], notePath: string, vaultId?: string): FetchResponse | null {
  const matches = documents
    .filter((document) => document.metadata.path === notePath && documentMatchesVault(document, vaultId))
    .sort(compareChunkOrder);

  if (matches.length === 0) {
    return null;
  }

  const first = matches[0];
  const title = noteTitle(first);
  return {
    ...first,
    title,
    text: matches.map((document) => document.text).join("\n\n"),
    obsidian_uri: first.metadata.obsidian_uri,
  };
}

export function listNotes(documents: VaultDocument[], options: ListNotesOptions = {}): ListNotesResponse {
  const offset = parseCursor(options.cursor);
  const limit = normalizeListLimit(options.limit);
  const notes = groupByNote(documents)
    .map((note) => note.summary)
    .filter((note) => noteMatchesFilters(note, options))
    .sort((a, b) => a.path.localeCompare(b.path));

  const page = notes.slice(offset, offset + limit);
  const next = offset + limit < notes.length ? String(offset + limit) : null;
  return {
    notes: page,
    next_cursor: next,
  };
}

export function recentNotes(documents: VaultDocument[], scope?: string, limit = DEFAULT_LIMIT, vaultId?: string): { notes: NoteSummary[] } {
  const notes = groupByNote(documents)
    .map((note) => note.summary)
    .filter((note) => (!vaultId || note.vault_id === vaultId) && (!scope || note.path.startsWith(scope)))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.path.localeCompare(b.path))
    .slice(0, normalizeListLimit(limit));

  return { notes };
}

export function activeProjects(documents: VaultDocument[], limit = DEFAULT_LIMIT, cursor?: string, vaultId?: string): ListNotesResponse {
  const offset = parseCursor(cursor);
  const normalizedLimit = normalizeListLimit(limit);
  const notes = groupByNote(documents)
    .map((note) => note.summary)
    .filter((note) => (!vaultId || note.vault_id === vaultId) && isActiveProject(note))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.path.localeCompare(b.path));

  return {
    notes: notes.slice(offset, offset + normalizedLimit),
    next_cursor: offset + normalizedLimit < notes.length ? String(offset + normalizedLimit) : null,
  };
}

export function getIndexStatus(documents: VaultDocument[], _stats: IndexStats | null, lastIndexedAt: string | null, vaultId?: string): IndexStatusResponse {
  const scopedDocuments = vaultId ? documents.filter((document) => documentMatchesVault(document, vaultId)) : documents;
  const first = scopedDocuments[0];
  return {
    tenant_id: first?.tenant_id ?? first?.metadata.tenant_id,
    vault_id: first?.vault_id ?? first?.metadata.vault_id,
    installation_id: first?.installation_id ?? first?.metadata.installation_id,
    indexed_note_count: groupByNote(scopedDocuments).length,
    indexed_section_count: scopedDocuments.length,
    last_indexed_at: lastIndexedAt,
    allowed_scopes: ALLOWED_SCOPES,
    excluded_scopes: EXCLUDED_SCOPES,
    index_version: INDEX_VERSION,
    policy_version: first?.metadata.source_policy.policy_version,
    index_mode: first?.metadata.source_policy.index_mode,
    embedding_model: null,
  };
}

export function debugSearch(documents: VaultDocument[], query: string, scope: string | undefined, lastIndexedAt: string | null, vaultId?: string): DebugSearchResponse {
  const normalizedQuery = normalize(query);
  const expanded = expandedQuery(normalizedQuery).expandedTerms;
  const resultCount = normalizedQuery ? searchVault(documents, { query, scope, vault_id: vaultId, limit: 5 }).results.length : 0;
  const possibleReasons = resultCount > 0
    ? ["Results were found in the allowlisted index."]
    : [
        "No indexed note contains this phrase or related expanded terms.",
        "The note may be outside allowlisted scopes.",
        "The index may be stale.",
      ];

  return {
    query,
    normalized_query: normalizedQuery,
    expanded_query_terms: expanded,
    searched_index: true,
    result_count: resultCount,
    possible_reasons: possibleReasons,
    last_indexed_at: lastIndexedAt,
  };
}

type NoteGroup = {
  summary: NoteSummary;
  documents: VaultDocument[];
};

type ExpandedQuery = {
  terms: string[];
  exactTerms: string[];
  expandedTerms: string[];
  phrase: string;
};

function groupByNote(documents: VaultDocument[]): NoteGroup[] {
  const groups = new Map<string, VaultDocument[]>();
  for (const document of documents) {
    const key = noteGroupKey(document);
    const group = groups.get(key) ?? [];
    group.push(document);
    groups.set(key, group);
  }

  return [...groups.values()].map((items) => {
    const sorted = [...items].sort(compareChunkOrder);
    const first = sorted[0];
    return {
      summary: {
        id: first.id,
        vault_id: first.vault_id ?? first.metadata.vault_id,
        title: noteTitle(first),
        path: first.metadata.path,
        tags: first.metadata.tags,
        status: noteStatus(first),
        type: noteType(first),
        updated_at: first.metadata.updated_at,
        obsidian_uri: first.metadata.obsidian_uri,
      },
      documents: sorted,
    };
  });
}

function scoreNote(note: NoteGroup, query: ExpandedQuery): { summary: NoteSummary; documents: VaultDocument[]; score: number; reasons: string[]; bestDocument: VaultDocument } {
  let score = 0;
  const reasons = new Set<string>();
  let bestDocument = note.documents[0];
  let bestDocumentScore = 0;
  const title = normalize(note.summary.title);
  const path = normalize(note.summary.path);
  const tagText = normalize(note.summary.tags.join(" "));

  if (title === query.phrase) {
    score += 120;
    reasons.add("title_exact");
  } else if (title.includes(query.phrase)) {
    score += 60;
    reasons.add("title_phrase");
  }

  for (const term of query.exactTerms) {
    if (title.includes(term)) {
      score += 20;
      reasons.add(`title_match:${term}`);
    }
    if (path.includes(term)) {
      score += 12;
      reasons.add(`path_match:${term}`);
    }
    if (tagText.includes(term)) {
      score += 15;
      reasons.add(`tag_match:${term}`);
    }
  }

  for (const term of query.expandedTerms) {
    if (title.includes(term) || path.includes(term) || tagText.includes(term)) {
      score += 6;
      reasons.add(`expanded_match:${term}`);
    }
  }

  for (const document of note.documents) {
    const scored = scoreDocument(document, query);
    if (scored.score > bestDocumentScore) {
      bestDocumentScore = scored.score;
      bestDocument = document;
    }
    score += scored.score * 0.8;
    for (const reason of scored.reasons) {
      reasons.add(reason);
    }
  }

  if (score > 0) {
    score += recencyBoost(note.summary.updated_at);
  }
  return {
    summary: note.summary,
    documents: note.documents,
    score,
    reasons: [...reasons],
    bestDocument,
  };
}

function scoreDocument(document: VaultDocument, query: ExpandedQuery): { score: number; reasons: string[] } {
  const title = normalize(document.title);
  const note = normalize(noteTitle(document));
  const path = normalize(document.metadata.path);
  const heading = normalize(document.metadata.heading ?? "");
  const text = normalize(document.text);
  const tags = normalize(document.metadata.tags.join(" "));
  let score = 0;
  const reasons = new Set<string>();

  if (note === query.phrase || title === query.phrase) {
    score += 100;
    reasons.add("title_exact");
  }
  if (title.includes(query.phrase) || text.includes(query.phrase)) {
    score += 25;
    reasons.add("phrase_match");
  }

  for (const term of query.exactTerms) {
    if (title.includes(term) || note.includes(term)) {
      score += 18;
      reasons.add(`title_match:${term}`);
    }
    if (path.includes(term)) {
      score += 10;
      reasons.add(`path_match:${term}`);
    }
    if (tags.includes(term)) {
      score += 14;
      reasons.add(`tag_match:${term}`);
    }
    if (heading.includes(term)) {
      score += 8;
      reasons.add(`heading_match:${term}`);
    }
    const matches = countOccurrences(text, term);
    if (matches > 0) {
      score += Math.min(matches, 8);
      reasons.add(`text_match:${term}`);
    }
  }

  for (const term of query.expandedTerms) {
    if (title.includes(term) || path.includes(term) || tags.includes(term) || heading.includes(term)) {
      score += 5;
      reasons.add(`expanded_match:${term}`);
    }
    const matches = countOccurrences(text, term);
    if (matches > 0) {
      score += Math.min(matches, 5) * 0.5;
      reasons.add(`expanded_text_match:${term}`);
    }
  }

  if (score > 0) {
    score += recencyBoost(document.metadata.updated_at);
  }
  return {
    score,
    reasons: [...reasons],
  };
}

function toNoteSearchResult(item: ReturnType<typeof scoreNote>, query: ExpandedQuery): SearchResult {
  const document = item.bestDocument;
  const snippet = createSnippet(document.text, query.terms);
  return {
    id: item.summary.id,
    vault_id: item.summary.vault_id,
    type: "note",
    title: item.summary.title,
    path: item.summary.path,
    url: document.url,
    obsidian_uri: item.summary.obsidian_uri,
    snippet,
    text_snippet: snippet,
    tags: item.summary.tags,
    status: item.summary.status,
    updated_at: item.summary.updated_at,
    score: roundScore(item.score),
    match_reasons: item.reasons,
    expanded_query_terms: query.expandedTerms,
    metadata: document.metadata,
  };
}

function toSectionSearchResult(document: VaultDocument, query: ExpandedQuery, score: number, reasons: string[]): SearchResult {
  const snippet = createSnippet(document.text, query.terms);
  return {
    id: document.id,
    vault_id: document.vault_id ?? document.metadata.vault_id,
    type: "section",
    title: document.title,
    note_title: noteTitle(document),
    section_title: document.metadata.heading,
    path: document.metadata.path,
    heading: document.metadata.heading,
    url: document.url,
    obsidian_uri: document.metadata.obsidian_uri,
    snippet,
    text_snippet: snippet,
    tags: document.metadata.tags,
    status: noteStatus(document),
    updated_at: document.metadata.updated_at,
    score: roundScore(score),
    match_reasons: reasons,
    expanded_query_terms: query.expandedTerms,
    metadata: document.metadata,
  };
}

function expandedQuery(normalizedQuery: string): ExpandedQuery {
  const exactTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const expandedTerms = [...new Set(exactTerms.flatMap((term) => SYNONYMS[term] ?? []))];
  return {
    terms: [...new Set([...exactTerms, ...expandedTerms])],
    exactTerms,
    expandedTerms,
    phrase: normalizedQuery,
  };
}

function noteMatchesFilters(note: NoteSummary, options: ListNotesOptions | SearchOptions): boolean {
  if (options.vault_id && note.vault_id !== options.vault_id) {
    return false;
  }
  if (options.scope && !note.path.startsWith(options.scope)) {
    return false;
  }
  if ("tag" in options && options.tag && !hasTag(note.tags, options.tag)) {
    return false;
  }
  if ("tags" in options && options.tags?.length && !options.tags.every((tag) => hasTag(note.tags, tag))) {
    return false;
  }
  if (options.status && note.status !== normalizeMetadataValue(options.status)) {
    return false;
  }
  if (options.type && note.type !== normalizeMetadataValue(options.type)) {
    return false;
  }
  return true;
}

function documentMatchesFilters(document: VaultDocument, options: SearchOptions): boolean {
  return noteMatchesFilters({
    id: document.id,
    vault_id: document.vault_id ?? document.metadata.vault_id,
    title: noteTitle(document),
    path: document.metadata.path,
    tags: document.metadata.tags,
    status: noteStatus(document),
    type: noteType(document),
    updated_at: document.metadata.updated_at,
    obsidian_uri: document.metadata.obsidian_uri,
  }, options);
}

function documentMatchesVault(document: VaultDocument, vaultId: string | undefined): boolean {
  return !vaultId || (document.vault_id ?? document.metadata.vault_id) === vaultId;
}

function noteGroupKey(document: VaultDocument): string {
  return [
    document.tenant_id ?? document.metadata.tenant_id ?? "default",
    document.vault_id ?? document.metadata.vault_id ?? "default",
    document.metadata.path,
  ].join("\u0000");
}

function isActiveProject(note: NoteSummary): boolean {
  const isProject = note.path.startsWith("20 Projects/") || note.type === "project" || hasTag(note.tags, "type/project");
  const isActive = note.status === null || note.status === "active" || hasTag(note.tags, "status/active");
  return isProject && isActive;
}

function hasTag(tags: string[], tag: string): boolean {
  const normalized = normalizeMetadataValue(tag);
  return tags.some((candidate) => normalizeMetadataValue(candidate) === normalized);
}

function noteType(document: VaultDocument): string | null {
  const tag = document.metadata.tags.find((candidate) => candidate.startsWith("type/"));
  return tag ? normalizeMetadataValue(tag.slice("type/".length)) : null;
}

function noteStatus(document: VaultDocument): string | null {
  if (document.metadata.status) {
    return normalizeMetadataValue(document.metadata.status);
  }
  const tag = document.metadata.tags.find((candidate) => candidate.startsWith("status/"));
  return tag ? normalizeMetadataValue(tag.slice("status/".length)) : null;
}

function noteTitle(document: VaultDocument): string {
  if (document.metadata.note_title || !document.metadata.heading) {
    return document.metadata.note_title ?? document.title;
  }

  return document.title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(document.metadata.heading)}$`), "");
}

function compareChunkOrder(a: VaultDocument, b: VaultDocument): number {
  return (a.metadata.chunk_index ?? 0) - (b.metadata.chunk_index ?? 0) || a.id.localeCompare(b.id);
}

function normalizeListLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));
}

function normalizeSearchLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, SEARCH_MAX_LIMIT));
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function createSnippet(text: string, terms: string[], maxLength = 280): string {
  const lower = normalize(text);
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

function recencyBoost(updatedAt: string): number {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - updated) / 86_400_000);
  return Math.max(0, 2 - ageDays / 180);
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMetadataValue(value: string): string {
  return normalize(value).replace(/^#/, "");
}

function withTopLevelObsidianUri(document: VaultDocument): VaultDocument {
  return {
    ...document,
    obsidian_uri: document.metadata.obsidian_uri,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
