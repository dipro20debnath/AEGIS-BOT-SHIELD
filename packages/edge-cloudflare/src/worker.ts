/**
 * AEGIS BOT SHIELD at the edge (Cloudflare Workers).
 *
 * Runs in front of a site protected by the AEGIS server middleware
 * (Node or Python) and stops cheap abuse before it reaches the origin:
 *
 *   1. rate limit per client IP (Workers Rate Limiting binding when
 *      configured, else a per-isolate fallback);
 *   2. on token-required paths, verify the X-Aegis-Token issued by the
 *      origin (same secret) and answer 403 without a valid one;
 *   3. refuse tokens whose verdict is "block" or whose score is at or above
 *      the block threshold;
 *   4. forward everything else, with X-Aegis-Edge stating what was checked.
 *
 * What it does not do: the ML model, telemetry scoring and the challenge
 * stay at the origin (telemetry and challenge requests pass through). The
 * origin middleware still verifies the token itself; X-Aegis-Edge is
 * informational and must not be trusted unless the origin only accepts
 * traffic from Cloudflare.
 */
import { TokenClaims, userAgentHash, verifyAegisToken } from './token.js';

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Same secret as the origin middleware (wrangler secret put AEGIS_SECRET_KEY) */
  AEGIS_SECRET_KEY: string;
  /** Comma-separated path prefixes that need a valid token, e.g. "/api/login,/api/checkout" */
  AEGIS_REQUIRE_TOKEN_PATHS?: string;
  /** Comma-separated path prefixes the worker ignores (passed through untouched) */
  AEGIS_EXCLUDED_PATHS?: string;
  AEGIS_BLOCK_THRESHOLD?: string;
  AEGIS_TOKEN_TTL?: string;
  /** "monitor": never deny, only annotate. Default "enforce" */
  AEGIS_MODE?: string;
  /** Origin base URL; when unset the request goes to the zone's origin (route mode) */
  AEGIS_ORIGIN?: string;
  /** Fallback limit per IP per minute when no AEGIS_RATE_LIMITER binding exists (default 120; 0 = off) */
  AEGIS_RATE_LIMIT?: string;
  AEGIS_TELEMETRY_PATH?: string;
  AEGIS_CHALLENGE_PATH?: string;
  /** Workers Rate Limiting binding ([[ratelimits]] in wrangler.toml) */
  AEGIS_RATE_LIMITER?: RateLimitBinding;
}

export interface EdgeConfig {
  secret: string;
  requireTokenPaths: string[];
  excludedPaths: string[];
  blockThreshold: number;
  tokenTtl: number;
  mode: 'monitor' | 'enforce';
  origin?: string;
  rateLimit: number;
  telemetryPath: string;
  challengePath: string;
}

const list = (value?: string) => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);

export function configFromEnv(env: Env): EdgeConfig {
  if (!env.AEGIS_SECRET_KEY || env.AEGIS_SECRET_KEY.length < 16) {
    throw new Error('AEGIS_SECRET_KEY must be set (at least 16 characters, same as the origin)');
  }
  return {
    secret: env.AEGIS_SECRET_KEY,
    requireTokenPaths: list(env.AEGIS_REQUIRE_TOKEN_PATHS),
    excludedPaths: list(env.AEGIS_EXCLUDED_PATHS),
    blockThreshold: Number(env.AEGIS_BLOCK_THRESHOLD ?? 80),
    tokenTtl: Number(env.AEGIS_TOKEN_TTL ?? 300),
    mode: env.AEGIS_MODE === 'monitor' ? 'monitor' : 'enforce',
    origin: env.AEGIS_ORIGIN?.replace(/\/$/, ''),
    rateLimit: Number(env.AEGIS_RATE_LIMIT ?? 120),
    telemetryPath: env.AEGIS_TELEMETRY_PATH ?? '/aegis/telemetry',
    challengePath: env.AEGIS_CHALLENGE_PATH ?? '/aegis/challenge',
  };
}

/**
 * Per-isolate sliding window. A Worker runs in many isolates across many
 * locations, so this only bounds what one isolate sees; use the Rate
 * Limiting binding for a limit that holds per Cloudflare location.
 */
export class IsolateRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private max: number, private windowMs = 60_000, private maxKeys = 10_000) {}

  allow(key: string, now = Date.now()): boolean {
    if (this.max <= 0) return true;
    const recent = (this.hits.get(key) ?? []).filter(t => t > now - this.windowMs);
    recent.push(now);
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    this.hits.set(key, recent.slice(-(this.max + 1)));
    return recent.length <= this.max;
  }
}

export type EdgeDecision =
  | { action: 'pass'; reason: 'excluded' | 'aegis_endpoint' | 'no_token' | 'invalid_token' | 'verified'; claims?: TokenClaims | null }
  | { action: 'rate_limited' }
  | { action: 'block' | 'challenge'; reason: string };

function sessionId(request: Request): string | undefined {
  const match = /(?:^|;\s*)aegis_sid=([^;]*)/.exec(request.headers.get('Cookie') ?? '');
  return match ? decodeURIComponent(match[1]).split('.')[0] : undefined;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export function createEdgeHandler(limiterFallback?: IsolateRateLimiter) {
  let fallback = limiterFallback;

  async function decide(request: Request, env: Env, config: EdgeConfig): Promise<EdgeDecision> {
    const path = new URL(request.url).pathname;
    if (config.excludedPaths.some(p => path.startsWith(p))) return { action: 'pass', reason: 'excluded' };

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.AEGIS_RATE_LIMITER) {
      if (!(await env.AEGIS_RATE_LIMITER.limit({ key: ip })).success) return { action: 'rate_limited' };
    } else {
      fallback ??= new IsolateRateLimiter(config.rateLimit);
      if (!fallback.allow(ip)) return { action: 'rate_limited' };
    }

    if (path === config.telemetryPath || path === config.challengePath) return { action: 'pass', reason: 'aegis_endpoint' };

    const token = request.headers.get('X-Aegis-Token');
    let claims: TokenClaims | null = null;
    if (token) {
      claims = await verifyAegisToken(token, config.secret, config.tokenTtl);
      if (claims && claims.uah !== await userAgentHash(request.headers.get('User-Agent') ?? '')) claims = null;
      // Bound to the session it was issued to (aegis_sid cookie: "id" in Python, "id.signature" in Node)
      if (claims && typeof claims.sid === 'string' && claims.sid !== 'anonymous' && claims.sid !== sessionId(request)) claims = null;
    }
    if (claims && (claims.verdict === 'block' || Number(claims.score ?? 0) >= config.blockThreshold)) {
      return { action: 'block', reason: 'token_verdict' };
    }
    const required = config.requireTokenPaths.some(p => path.startsWith(p));
    // Proof of work alone does not carry behavioural evidence (same rule as the origin)
    const hasTelemetry = !!claims && (!claims.pow || !!claims.tel);
    if (required && !hasTelemetry) return { action: 'challenge', reason: token ? 'invalid_token' : 'token_required' };
    // An invalid token on an open path goes on: the origin scores it (invalid_token signal)
    if (token && !claims) return { action: 'pass', reason: 'invalid_token' };
    return { action: 'pass', reason: claims ? 'verified' : 'no_token', claims };
  }

  async function forward(request: Request, config: EdgeConfig, edgeHeader: string): Promise<Response> {
    const url = new URL(request.url);
    const target = config.origin ? new URL(url.pathname + url.search, config.origin) : url;
    const headers = new Headers(request.headers);
    // Clients must not be able to send their own edge verdict
    for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('x-aegis-edge')) headers.delete(name);
    headers.set('X-Aegis-Edge', edgeHeader);
    return fetch(new Request(target.toString(), {
      method: request.method, headers, body: request.body, redirect: 'manual',
      // Required by the Fetch spec when streaming a body
      ...(request.body ? { duplex: 'half' } : {}),
    } as RequestInit));
  }

  return {
    decide,
    async fetch(request: Request, env: Env): Promise<Response> {
      let config: EdgeConfig;
      try {
        config = configFromEnv(env);
      } catch (error) {
        return json(500, { error: (error as Error).message });
      }
      const decision = await decide(request, env, config);
      const enforce = config.mode === 'enforce';

      if (decision.action === 'rate_limited') {
        if (enforce) return json(429, { aegis: 'rate_limited' }, { 'Retry-After': '60', 'X-Aegis-Action': 'rate_limited' });
        return forward(request, config, 'monitor; would=rate_limited');
      }
      if (decision.action === 'pass') {
        const score = decision.claims ? `; score=${Number(decision.claims.score ?? 0)}` : '';
        return forward(request, config, `${decision.reason}${score}`);
      }
      if (!enforce) return forward(request, config, `monitor; would=${decision.action}; reason=${decision.reason}`);
      const body: Record<string, unknown> = { aegis: decision.action, reason: decision.reason };
      if (decision.action === 'challenge') {
        body.telemetry = config.telemetryPath;
        body.challenge = config.challengePath;
      }
      return json(403, body, { 'X-Aegis-Action': decision.action });
    },
  };
}

const handler = createEdgeHandler();

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handler.fetch(request, env),
};
