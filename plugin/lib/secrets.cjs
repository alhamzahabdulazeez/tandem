'use strict';
/**
 * Secret detection for content an agent writes or commits. High-precision
 * patterns for well-known credential formats, plus a generic
 * `key = "..."` rule gated by entropy and placeholder filtering.
 * Findings are redacted: the secret itself is never echoed back.
 */

const RULES = [
  // header followed by real key material, not a "\nXXXX\n" doc placeholder
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----(?:\\n|\r?\n)[A-Za-z0-9+/=]{40,}/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: 'anthropic-key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/g },
  { id: 'openai-key', re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: 'slack-token', re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/g },
  { id: 'stripe-live-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { id: 'telegram-bot-token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { id: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:([^\s@/'"$<{]{6,})@[^\s'"]+/gi },
];

// key name must END in a credential word (apiKey, DB_PASSWORD, authToken; not "lastSignificantToken"-style
// names with a non-credential prefix check below), value must look like a token, not an identifier.
const GENERIC = /\b([A-Za-z0-9_]*?(?:api[_-]?key|secret(?:[_-]?key)?|token|passw(?:or)?d|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token))\b['"]?\s*[:=]\s*['"`]([A-Za-z0-9+/=_.-]{20,})['"`]/gi;
const NOT_CRED_NAME = /(?:significant|last|next|prev|first|csrf|cancel|page|continuation|sync|lexer|parse|syntax|word|max|min|count|num|type|kind)[_-]?token$/i;
const PLACEHOLDER = /^(?:x+|\*+|\.+|<.*>|\$\{.*\}|\{\{.*\}\})$|example|placeholder|your[_-]|changeme|change[_-]me|dummy|sample|fake|test|xxxx|redacted|todo|replace|insert|secret_here|my[_-]?(?:api|secret)|abc123|123456|process\.env|os\.environ|getenv/i;

function entropy(s) {
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let h = 0;
  for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

function redact(s) {
  const v = String(s);
  return v.length <= 8 ? '****' : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)`;
}

/** @returns {{ rule: string, sample: string }[]} */
function scan(text) {
  const t = String(text || '');
  const out = [];
  const seen = new Set();
  for (const r of RULES) {
    for (const m of t.matchAll(r.re)) {
      const val = r.id === 'url-credentials' ? m[1] : m[0];
      if (r.id === 'url-credentials' && (PLACEHOLDER.test(val) || /^(?:pass(?:word)?|pwd|secret|token|user(?:name)?)$/i.test(val))) continue;
      if (seen.has(val)) continue;
      seen.add(val);
      out.push({ rule: r.id, value: val, sample: redact(val) });
    }
  }
  for (const m of t.matchAll(GENERIC)) {
    const val = m[2];
    if (seen.has(val) || PLACEHOLDER.test(val) || NOT_CRED_NAME.test(m[1])) continue;
    if (entropy(val) < 3.5 || !/[0-9]/.test(val) || !/[A-Za-z]/.test(val)) continue;
    if (/^[a-z]+(?:[-_.][a-z0-9]+)+$/i.test(val) && !/[A-Z].*[0-9]|[0-9].*[A-Z]/.test(val)) continue; // kebab/snake identifiers
    if (/^[\w.-]+\.(?:js|ts|json|py|md|com|org|io|net)$/i.test(val)) continue;
    seen.add(val);
    out.push({ rule: `hardcoded-${m[1].toLowerCase()}`, value: val, sample: redact(val) });
  }
  return out;
}

/** Secrets present in `after` that were not already in `before`. */
function added(before, after) {
  const old = new Set(scan(before).map((f) => f.value));
  return scan(after).filter((f) => !old.has(f.value));
}

function describe(findings) {
  return findings.map((f) => `${f.rule} ${f.sample}`).join('; ');
}

module.exports = { scan, added, describe, entropy };
