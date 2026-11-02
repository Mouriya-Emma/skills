// Refuse to publish evidence text that looks like a credential.

export type SecretHit = { readonly where: string; readonly line: number; readonly kind: string };

const PATTERNS: readonly { kind: string; re: RegExp }[] = [
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "API key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: "Authorization header", re: /\bAuthorization:\s*(?:Bearer|token|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { kind: "credential assignment", re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"'*<>]{8,}/i },
];

export function scanSecrets(where: string, text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  text.split("\n").forEach((l, i) => {
    for (const p of PATTERNS) if (p.re.test(l)) hits.push({ where, line: i + 1, kind: p.kind });
  });
  return hits;
}
