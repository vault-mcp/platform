export type SourcePolicyDecision = {
  allowed: boolean;
  reason: string;
  matchedRule: string;
  reviewRequired?: boolean;
};

export type SourcePolicyMetadata = {
  allowed: boolean;
  reason: string;
  matched_rule: string;
  review_required?: boolean;
  policy_version?: string;
  index_mode?: IndexMode;
};

export type IndexMode = "rules_plus_approvals" | "manual_only" | "rules_only";

export type WriteMode = "review_required" | "direct_apply";

export type IndexRuleAction = "allow" | "deny" | "review";

export type IndexRuleKind = "path_prefix" | "path_exact" | "tag" | "status";

export type IndexPolicyRule = {
  id: string;
  action: IndexRuleAction;
  kind: IndexRuleKind;
  value: string;
  reason: string;
};

export type IndexPolicy = {
  version: string;
  mode: IndexMode;
  rules: IndexPolicyRule[];
  manual_allow_paths?: string[];
  manual_allow_prefixes?: string[];
};

export type VaultInstallation = {
  tenant_id: string;
  vault_id: string;
  installation_id: string;
  vault_name: string;
  index_mode: IndexMode;
  write_mode: WriteMode;
  created_at: string;
  updated_at: string;
};

export type SyncManifest = {
  tenant_id: string;
  vault_id: string;
  installation_id: string;
  vault_name: string;
  generated_at: string;
  policy_version: string;
  index_mode: IndexMode;
  policy_summary: {
    allowed_rules: string[];
    denied_rules: string[];
    review_rules: string[];
  };
};

export type VaultDocumentMetadata = {
  tenant_id?: string;
  vault_id?: string;
  installation_id?: string;
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
  tenant_id?: string;
  vault_id?: string;
  installation_id?: string;
  title: string;
  text: string;
  url: string;
  obsidian_uri?: string;
  metadata: VaultDocumentMetadata;
};

export type SearchResult = {
  id: string;
  vault_id?: string;
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
  vault_id?: string;
  title: string;
  path: string;
  tags: string[];
  status: string | null;
  type: string | null;
  updated_at: string;
  obsidian_uri: string;
};

export type ListNotesOptions = {
  vault_id?: string;
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
  vault_id?: string;
  scope?: string;
  tags?: string[];
  status?: string;
  type?: string;
  limit?: number;
};

export type IndexStatusResponse = {
  tenant_id?: string;
  vault_id?: string;
  installation_id?: string;
  vault_name?: string;
  indexed_note_count: number;
  indexed_section_count: number;
  last_indexed_at: string | null;
  allowed_scopes: string[];
  excluded_scopes: string[];
  index_version: string;
  policy_version?: string;
  index_mode?: IndexMode;
  embedding_model: string | null;
};

export type VaultStatus = IndexStatusResponse & {
  document_count: number;
  generated_at: string | null;
  stats: IndexStats | null;
};

export type VaultSummary = {
  tenant_id: string;
  vault_id: string;
  installation_id: string | null;
  vault_name: string;
  index_mode: IndexMode | null;
  document_count: number;
  last_indexed_at: string | null;
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
  review_required_markdown?: number;
  reviewed_by_rule?: Record<string, number>;
  redacted_documents?: number;
  redactions_by_pattern?: Record<string, number>;
};

export type VaultIndex = {
  generated_at: string;
  vault_root: string;
  documents: VaultDocument[];
  stats: IndexStats;
  manifest?: SyncManifest;
  manifests?: SyncManifest[];
  write_proposals?: WriteProposal[];
};

export type SyncPayload = {
  tenant_id?: string;
  vault_id?: string;
  installation_id?: string;
  vault_name?: string;
  policy_version?: string;
  index_mode?: IndexMode;
  manifest?: SyncManifest;
  documents: VaultDocument[];
  generated_at?: string;
  stats?: IndexStats;
};

export type WriteOperation = "append_to_note" | "replace_note" | "create_note" | "update_frontmatter" | "rename_note";

export type WriteProposalStatus = "pending" | "approved" | "rejected" | "applied" | "conflict" | "failed";

export type WriteAuditEntry = {
  status: WriteProposalStatus;
  actor: string;
  message: string;
  created_at: string;
};

export type WriteProposal = {
  id: string;
  tenant_id: string;
  vault_id: string;
  operation: WriteOperation;
  target_path: string;
  base_content_hash: string | null;
  proposed_content?: string;
  proposed_patch?: string;
  requester: string;
  status: WriteProposalStatus;
  created_at: string;
  updated_at: string;
  audit: WriteAuditEntry[];
};
