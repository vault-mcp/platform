export type SourcePolicyDecision = {
  allowed: boolean;
  reason: string;
  matchedRule: string;
};

export type SourcePolicyMetadata = {
  allowed: boolean;
  reason: string;
  matched_rule: string;
};

export type VaultDocumentMetadata = {
  path: string;
  heading: string | null;
  note_title?: string;
  chunk_index?: number;
  tags: string[];
  status: string | null;
  updated_at: string;
  content_hash: string;
  obsidian_uri: string;
  source_policy: SourcePolicyMetadata;
};

export type VaultDocument = {
  id: string;
  title: string;
  text: string;
  url: string;
  obsidian_uri?: string;
  metadata: VaultDocumentMetadata;
};

export type SearchResult = {
  id: string;
  type?: "note" | "section";
  title: string;
  note_title?: string;
  section_title?: string | null;
  path?: string;
  heading?: string | null;
  url: string;
  obsidian_uri?: string;
  snippet?: string;
  text_snippet: string;
  tags?: string[];
  status?: string | null;
  updated_at?: string;
  score?: number;
  match_reasons?: string[];
  expanded_query_terms?: string[];
  metadata: VaultDocumentMetadata;
};

export type SearchResponse = {
  results: SearchResult[];
};

export type FetchResponse = VaultDocument;

export type NoteSummary = {
  id: string;
  title: string;
  path: string;
  tags: string[];
  status: string | null;
  type: string | null;
  updated_at: string;
  obsidian_uri: string;
};

export type ListNotesOptions = {
  scope?: string;
  tag?: string;
  status?: string;
  type?: string;
  limit?: number;
  cursor?: string;
};

export type ListNotesResponse = {
  notes: NoteSummary[];
  next_cursor: string | null;
};

export type SearchMode = "notes" | "sections";

export type SearchOptions = {
  query: string;
  mode?: SearchMode;
  scope?: string;
  tags?: string[];
  status?: string;
  type?: string;
  limit?: number;
};

export type IndexStatusResponse = {
  indexed_note_count: number;
  indexed_section_count: number;
  last_indexed_at: string | null;
  allowed_scopes: string[];
  excluded_scopes: string[];
  index_version: string;
  embedding_model: string | null;
};

export type DebugSearchResponse = {
  query: string;
  normalized_query: string;
  expanded_query_terms: string[];
  searched_index: boolean;
  result_count: number;
  possible_reasons: string[];
  last_indexed_at: string | null;
};

export type IndexStats = {
  scanned_markdown: number;
  allowed_documents: number;
  denied_markdown: number;
  denied_by_rule: Record<string, number>;
  redacted_documents?: number;
  redactions_by_pattern?: Record<string, number>;
};

export type VaultIndex = {
  generated_at: string;
  vault_root: string;
  documents: VaultDocument[];
  stats: IndexStats;
};

export type SyncPayload = {
  documents: VaultDocument[];
  generated_at?: string;
  stats?: IndexStats;
};
