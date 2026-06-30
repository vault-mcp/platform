export const REQUIRED_BRAT_SCREENSHOTS = [
  "brat-repo-config",
  "brat-install-update",
  "community-plugin-enabled",
  "vault-mcp-readiness",
  "vault-mcp-check-connection",
  "vault-mcp-preview-index",
  "vault-mcp-sync-summary",
];

export const REQUIRED_BRAT_REVIEW_FLAGS = [
  "matchesRequiredScreen",
  "copiedVaultOrSafeContext",
  "noSecretsVisible",
];

export function defaultScreenshotReview() {
  return Object.fromEntries(
    REQUIRED_BRAT_SCREENSHOTS.map((key) => [
      key,
      {
        matchesRequiredScreen: false,
        copiedVaultOrSafeContext: false,
        noSecretsVisible: false,
        reviewer: "",
        reviewedAt: "",
        notes: "",
      },
    ]),
  );
}
