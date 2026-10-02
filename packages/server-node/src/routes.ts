import { Router, Request, Response } from 'express';
import { verifyToken } from '@aegis/core';
import { AegisNode } from './AegisNode.js';

/**
 * Read-only status API for the dashboard. Mount it behind authentication:
 * stats and recent events describe your traffic.
 */
export function aegisRoutes(aegis: AegisNode) {
  const router = Router();

  router.get('/aegis/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now(), version: '1.0.0' });
  });

  router.get('/aegis/stats', (_req: Request, res: Response) => {
    res.json(aegis.stats.summary());
  });

  router.get('/aegis/events', (req: Request, res: Response) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json(aegis.stats.recent(limit));
  });

  router.get('/aegis/config', (_req: Request, res: Response) => {
    const { mode, thresholds, requireTokenPaths, protectedPaths, excludedPaths, tokenTtl, mlUrl } = aegis.options;
    res.json({ siteKeyConfigured: !!aegis.options.siteKey, mode, thresholds, requireTokenPaths,
      protectedPaths: protectedPaths ?? 'all', excludedPaths, tokenTtl, mlEnabled: !!mlUrl });
  });

  /** Verify a token server-to-server (e.g. from another backend). */
  router.post('/aegis/verify', (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const claims = token ? verifyToken(token, aegis.options.secretKey, aegis.options.tokenTtl) : null;
    res.status(claims ? 200 : 401).json(claims ? { valid: true, score: claims.score, verdict: claims.verdict } : { valid: false });
  });

  return router;
}
