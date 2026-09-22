import { Request, Response, NextFunction } from 'express';
import { TokenVerifier } from '../TokenVerifier.js';
import { Logger } from '@aegis/core';

export interface AegisExpressOptions {
  siteKey: string;
  secretKey: string;
  /** Paths to protect (default: all) */
  protectedPaths?: string[];
  /** Paths to exclude from protection */
  excludedPaths?: string[];
  /** Action on block: 'reject' | 'challenge' | 'log' */
  blockAction?: 'reject' | 'challenge' | 'log';
  /** Custom block response */
  onBlock?: (req: Request, res: Response, result: any) => void;
  /** Custom challenge response */
  onChallenge?: (req: Request, res: Response, result: any) => void;
  /** Token header name */
  tokenHeader?: string;
  /** Enable request logging */
  logging?: boolean;
  /** Risk score thresholds */
  thresholds?: { block: number; challenge: number };
}

/**
 * AEGIS BOT SHIELD Express Middleware
 *
 * Protects Express.js routes from automated bot attacks.
 * Extracts AEGIS token from request headers, verifies it,
 * and makes a verdict decision (allow/block/challenge).
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { aegisExpress } from '@aegis/server-node';
 *
 * const app = express();
 * app.use(aegisExpress({
 *   siteKey: process.env.AEGIS_SITE_KEY!,
 *   secretKey: process.env.AEGIS_SECRET_KEY!,
 *   protectedPaths: ['/api/login', '/api/checkout'],
 *   blockAction: 'reject',
 * }));
 * ```
 */
export function aegisExpress(options: AegisExpressOptions) {
  const verifier = new TokenVerifier(options.secretKey);
  const logger = new Logger('AegisExpress');
  const tokenHeader = options.tokenHeader || 'x-aegis-token';
  const thresholds = options.thresholds || { block: 80, challenge: 50 };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Check if path should be protected
      if (options.excludedPaths?.some(p => req.path.startsWith(p))) { next(); return; }
      if (options.protectedPaths && !options.protectedPaths.some(p => req.path.startsWith(p))) { next(); return; }

      // 2. Extract token
      const token = req.headers[tokenHeader] as string | undefined;

      // 3. Build AegisRequest from Express request
      const aegisRequest = {
        ip: req.ip || req.socket.remoteAddress || '0.0.0.0',
        headers: req.headers as Record<string, string>,
        method: req.method,
        path: req.path,
        query: req.query as Record<string, string>,
        body: req.body,
        aegisToken: token,
        timestamp: Date.now(),
        requestId: req.headers['x-request-id'] as string || generateRequestId(),
      };

      // 4. Verify token and get result
      const result = await verifier.verify(aegisRequest);

      // 5. Attach result to request for downstream use
      (req as any).aegis = result;

      // 6. Make verdict decision
      if (result.riskScore >= thresholds.block) {
        if (options.onBlock) { options.onBlock(req, res, result); return; }
        res.status(403).json({ error: 'Request blocked by AEGIS Bot Shield', requestId: result.requestId });
        return;
      }

      if (result.riskScore >= thresholds.challenge) {
        if (options.onChallenge) { options.onChallenge(req, res, result); return; }
        res.status(429).json({ challenge: true, type: 'pow', difficulty: 4, requestId: result.requestId });
        return;
      }

      // 7. Log if enabled
      if (options.logging) {
        logger.info('Request analyzed', { path: req.path, ip: aegisRequest.ip, score: result.riskScore, verdict: result.verdict });
      }

      next();
    } catch (error) {
      // Fail-open: never crash the application
      logger.error('AEGIS middleware error', error as Error);
      next();
    }
  };
}

function generateRequestId(): string {
  return `aegis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
