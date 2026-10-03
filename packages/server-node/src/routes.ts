import { Router, Request, Response } from 'express';
import { verifyToken } from '@aegis/core';
import { AegisNode } from './AegisNode.js';
import { aegisGraphQL } from './graphql.js';
import { serveOpenapi, serveSwaggerUi } from './openapi.js';

/**
 * Read-only status API for the dashboard: REST endpoints and the same data
 * through GraphQL at /aegis/graphql (graphql.ts). Mount it behind
 * authentication: stats and recent events describe your traffic.
 * POST endpoints need a JSON body parser (express.json()) before this router.
 */
export function aegisRoutes(aegis: AegisNode) {
  const router = Router();

  router.get('/aegis/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now(), version: '1.0.0' });
  });

  // Readiness for orchestrators (Kubernetes readinessProbe); /aegis/health is liveness
  router.get('/aegis/ready', async (_req: Request, res: Response) => {
    const result = await aegis.readiness();
    res.status(result.ready ? 200 : 503).json(result);
  });

  // Prometheus metrics (aegis_* plus process metrics)
  router.get('/aegis/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', aegis.metrics.contentType);
    res.send(await aegis.metrics.text());
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
      protectedPaths: protectedPaths ?? 'all', excludedPaths, tokenTtl, mlEnabled: !!mlUrl, sharedStore: !!aegis.options.store });
  });

  /** Verify a token server-to-server (e.g. from another backend). */
  router.post('/aegis/verify', (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const claims = token ? verifyToken(token, aegis.options.secretKey, aegis.options.tokenTtl) : null;
    res.status(claims ? 200 : 401).json(claims ? { valid: true, score: claims.score, verdict: claims.verdict } : { valid: false });
  });

  router.all('/aegis/graphql', aegisGraphQL(aegis));

  // OpenAPI document of every AEGIS endpoint (contracts/openapi.json) and Swagger UI
  router.get('/aegis/openapi.json', serveOpenapi);
  router.get('/aegis/docs', serveSwaggerUi);

  return router;
}
