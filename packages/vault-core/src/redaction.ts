export type RedactionResult = {
  text: string;
  redactionCount: number;
  redactionsByPattern: Record<string, number>;
};

const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  },
  {
    name: "env-secret",
    pattern: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY)\s*=\s*["']?[^"'\s]+["']?/gi,
  },
  {
    name: "password-field",
    pattern: /\bpassword\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  },
  {
    name: "ssh-public-key",
    pattern: /\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]+(?:\s+\S+)?/gi,
  },
];

export function redactSensitiveContent(markdown: string): RedactionResult {
  let text = markdown;
  const redactionsByPattern: Record<string, number> = {};

  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, () => {
      redactionsByPattern[name] = (redactionsByPattern[name] ?? 0) + 1;
      return `[REDACTED:${name}]`;
    });
  }

  return {
    text,
    redactionCount: Object.values(redactionsByPattern).reduce((sum, count) => sum + count, 0),
    redactionsByPattern,
  };
}
