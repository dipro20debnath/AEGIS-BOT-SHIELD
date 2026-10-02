/**
 * Pattern-based detection of injection payloads in request input:
 * XSS, SQL injection, CRLF/header injection, prototype pollution and path
 * traversal.
 *
 * This flags typical attack-tool payloads (scanners, fuzzers, bots probing
 * forms). It is not a replacement for a WAF, output encoding or
 * parameterised queries: obfuscated payloads can evade patterns, and free
 * text can trigger them. Fields whose content is legitimately arbitrary
 * (passwords, tokens) are skipped by default.
 */
import { DetectionSignal } from '../types/index.js';

export type InputThreat = 'xss' | 'sqli' | 'crlf' | 'prototype_pollution' | 'path_traversal';

export interface InputFinding {
  threat: InputThreat;
  /** Where the value was found, e.g. "body.comment" or "query.id" */
  location: string;
  /** Name of the rule that matched */
  rule: string;
}

export interface InputValidatorOptions {
  /** Field names (case-insensitive regex) not inspected; default: passwords, tokens, secrets */
  skipFields?: RegExp;
  /** Maximum nesting depth and number of values inspected per request */
  maxDepth?: number;
  maxValues?: number;
}

const RULES: Array<{ threat: InputThreat; rule: string; pattern: RegExp }> = [
  { threat: 'xss', rule: 'script_tag', pattern: /<\s*script\b/i },
  { threat: 'xss', rule: 'javascript_uri', pattern: /\bjavascript\s*:/i },
  { threat: 'xss', rule: 'event_handler', pattern: /<[^>]*\bon[a-z]+\s*=/i },
  { threat: 'xss', rule: 'dangerous_tag', pattern: /<\s*(iframe|object|embed|svg|math|base)\b/i },
  { threat: 'xss', rule: 'srcdoc_or_data_html', pattern: /\bsrcdoc\s*=|data\s*:\s*text\/html/i },
  { threat: 'sqli', rule: 'tautology', pattern: /['"`]\s*(or|and)\s+['"`]?\w+['"`]?\s*(=|like)\s*['"`]?\w+/i },
  { threat: 'sqli', rule: 'union_select', pattern: /\bunion\b[\s\S]{0,40}\bselect\b/i },
  { threat: 'sqli', rule: 'stacked_query', pattern: /;\s*(drop|delete|insert|update|alter|create|truncate|exec)\s/i },
  { threat: 'sqli', rule: 'comment_after_quote', pattern: /['"`]\s*(--|#|\/\*)/ },
  { threat: 'sqli', rule: 'time_based', pattern: /\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i },
  { threat: 'sqli', rule: 'schema_probe', pattern: /\binformation_schema\b|\bxp_cmdshell\b/i },
  { threat: 'path_traversal', rule: 'dot_dot_slash', pattern: /(^|[\\/])\.\.([\\/]|$)/ },
  { threat: 'path_traversal', rule: 'sensitive_file', pattern: /\/etc\/passwd|\\windows\\win\.ini|\/proc\/self\//i },
];

const CRLF = /[\r\n]/;
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SIGNAL_VALUES: Record<InputThreat, number> = {
  xss: 85, sqli: 85, crlf: 70, prototype_pollution: 90, path_traversal: 75,
};

/** Decode %xx escapes (repeatedly, to catch double encoding); returns the input on malformed escapes. */
function decode(value: string): string {
  let current = value;
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(current); i++) {
    try {
      current = decodeURIComponent(current.replace(/\+/g, ' '));
    } catch {
      break;
    }
  }
  return current;
}

export class InputValidator {
  private skipFields: RegExp;
  private maxDepth: number;
  private maxValues: number;

  constructor(options: InputValidatorOptions = {}) {
    this.skipFields = options.skipFields ?? /pass(word)?|pwd|secret|token|api[_-]?key|otp|cvv|card/i;
    this.maxDepth = options.maxDepth ?? 8;
    this.maxValues = options.maxValues ?? 500;
  }

  /** Inspect a string value. `isHeader` adds the CRLF check. */
  public inspectString(value: string, location: string, isHeader = false): InputFinding[] {
    const findings: InputFinding[] = [];
    const decoded = decode(value);
    for (const candidate of decoded === value ? [value] : [value, decoded]) {
      for (const { threat, rule, pattern } of RULES) {
        if (pattern.test(candidate) && !findings.some(f => f.rule === rule)) {
          findings.push({ threat, location, rule });
        }
      }
    }
    if (isHeader && (CRLF.test(value) || CRLF.test(decoded))) {
      findings.push({ threat: 'crlf', location, rule: 'crlf_in_header' });
    }
    return findings;
  }

  /** Walk an object/array/string (body, query) and inspect keys and string leaves. */
  public inspect(input: unknown, location: string): InputFinding[] {
    const findings: InputFinding[] = [];
    let visited = 0;

    const walk = (value: unknown, path: string, depth: number): void => {
      if (visited++ >= this.maxValues || depth > this.maxDepth) return;
      if (typeof value === 'string') {
        findings.push(...this.inspectString(value, path));
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      } else if (value && typeof value === 'object') {
        // Own keys only: Object.keys sees "__proto__" parsed from JSON as a plain key
        for (const key of Object.keys(value)) {
          const keyPath = `${path}.${key}`;
          const bracketKeys = key.match(/\[([^\]]*)\]/g)?.map(k => k.slice(1, -1)) ?? [];
          if (POLLUTION_KEYS.has(key) || bracketKeys.some(k => POLLUTION_KEYS.has(k))) {
            findings.push({ threat: 'prototype_pollution', location: keyPath, rule: 'pollution_key' });
          }
          if (this.skipFields.test(key)) continue;
          walk((value as Record<string, unknown>)[key], keyPath, depth + 1);
        }
      }
    };
    walk(input, location, 0);
    return findings;
  }

  /** Inspect the parts of a request an attacker controls and return detection signals. */
  public analyze(request: {
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  }): { findings: InputFinding[]; signals: DetectionSignal[] } {
    const findings = [
      ...this.inspectString(request.path, 'path'),
      ...(request.query ? this.inspect(request.query, 'query') : []),
      ...(request.body !== undefined && request.body !== null ? this.inspect(request.body, 'body') : []),
    ];
    for (const [name, raw] of Object.entries(request.headers ?? {})) {
      for (const value of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) {
        if (CRLF.test(value)) findings.push({ threat: 'crlf', location: `headers.${name}`, rule: 'crlf_in_header' });
      }
    }

    const byThreat = new Map<InputThreat, InputFinding[]>();
    for (const f of findings) byThreat.set(f.threat, [...(byThreat.get(f.threat) ?? []), f]);
    const signals: DetectionSignal[] = [...byThreat.entries()].map(([threat, list]) => ({
      category: 'payload',
      type: `input.${threat}`,
      value: SIGNAL_VALUES[threat],
      // More independent matches -> more confidence it is a payload, not free text
      confidence: Math.min(0.95, 0.6 + 0.1 * list.length),
      description: `Possible ${threat.replace('_', ' ')} payload in ${[...new Set(list.map(f => f.location))].slice(0, 3).join(', ')}`,
      weight: 1.3,
    }));
    return { findings, signals };
  }
}
