import type { Request, Response, NextFunction } from 'express';
import { AegisNode, AegisNodeOptions, HandlerResponse, parseCookies } from '../AegisNode.js';

export type AegisExpressOptions = AegisNodeOptions & {
  /** Custom response for blocked/challenged requests */
  onDeny?: (req: Request, res: Response, decision: import('../AegisNode.js').AegisDecision) => void;
  /** Called with the decision for every analysed request */
  onDecision?: (req: Request, decision: import('../AegisNode.js').AegisDecision) => void;
};

function send(res: Response, r: HandlerResponse): void {
  for (const [name, value] of Object.entries(r.headers)) res.setHeader(name, value);
  res.status(r.status).json(r.body);
}

/**
 * AEGIS BOT SHIELD Express middleware.
 *
 * Answers the SDK's telemetry endpoint and decides on every protected
 * request. The decision is available as `req.aegis` in route handlers.
 *
 * @example
 * ```typescript
 * app.use(aegisExpress({
 *   siteKey: process.env.AEGIS_SITE_KEY!,
 *   secretKey: process.env.AEGIS_SECRET_KEY!,
 *   requireTokenPaths: ['/api/login', '/api/checkout'],
 * }));
 * ```
 * Pass an existing `AegisNode` as second argument to share state (e.g. with aegisRoutes).
 */
export function aegisExpress(options: AegisExpressOptions, shared?: AegisNode) {
  const aegis = shared ?? new AegisNode(options);

  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const info = { method: req.method, path: req.path, ip: req.ip || req.socket.remoteAddress || '', headers: req.headers, cookies };

      if (aegis.isTelemetryRequest(req.method, req.path)) {
        const body = req.body !== undefined && Object.keys(req.body ?? {}).length > 0 ? req.body : await readBody(req);
        send(res, await aegis.handleTelemetry({ ...info, body }));
        return;
      }
      if (!aegis.shouldProtect(req.path)) { next(); return; }

      const { decision, headers } = await aegis.evaluate({ ...info, query: req.query as Record<string, unknown>, body: req.body });
      (req as any).aegis = decision;
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      options.onDecision?.(req, decision);

      if (decision.verdict === 'block' || decision.verdict === 'challenge') {
        if (options.onDeny) { options.onDeny(req, res, decision); return; }
        send(res, aegis.denial(decision));
        return;
      }
      next();
    } catch (error) {
      // Fail open: a detection error must never take the site down
      next();
    }
  };
  return Object.assign(middleware, { aegis });
}

function readBody(req: Request, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
