/**
 * Recommended HTTP security response headers (OWASP Secure Headers Project).
 * The values are conservative defaults; override `contentSecurityPolicy` for
 * pages that load third-party scripts.
 */
export interface SecurityHeaderOptions {
  /** Full CSP string; false to omit */
  contentSecurityPolicy?: string | false;
  /** Send HSTS (only meaningful over HTTPS). Default true */
  hsts?: boolean;
  hstsMaxAge?: number;
  hstsIncludeSubDomains?: boolean;
  /** X-Frame-Options; frame-ancestors in the CSP is the modern equivalent */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  referrerPolicy?: string;
  permissionsPolicy?: string | false;
  crossOriginOpenerPolicy?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none' | false;
}

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': options.referrerPolicy ?? 'strict-origin-when-cross-origin',
  };
  const csp = options.contentSecurityPolicy ?? DEFAULT_CSP;
  if (csp) headers['Content-Security-Policy'] = csp;
  if (options.hsts ?? true) {
    const maxAge = options.hstsMaxAge ?? 31_536_000;
    headers['Strict-Transport-Security'] = `max-age=${maxAge}${(options.hstsIncludeSubDomains ?? true) ? '; includeSubDomains' : ''}`;
  }
  const frame = options.frameOptions ?? 'DENY';
  if (frame) headers['X-Frame-Options'] = frame;
  const permissions = options.permissionsPolicy ?? 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
  if (permissions) headers['Permissions-Policy'] = permissions;
  const coop = options.crossOriginOpenerPolicy ?? 'same-origin';
  if (coop) headers['Cross-Origin-Opener-Policy'] = coop;
  return headers;
}
