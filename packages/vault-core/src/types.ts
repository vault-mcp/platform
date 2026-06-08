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
  metadata: VaultDocumentMetadata;
};

export type SearchResult = {
  id: string;
  title: string;
  url: string;
  text_snippet: string;
  metadata: VaultDocumentMetadata;
};

export type SearchResponse = {
  results: SearchResult[];
};

export type FetchResponse = VaultDocument;

export type IndexStats = {
  scanned_markdown: number;
  allowed_documents: number;
  denied_markdown: number;
  denied_by_rule: Record<string, number>;
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
