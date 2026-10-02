import type { Request, Response, NextFunction } from 'express';
import { AntiTamper, SIGNATURE_HEADER } from '@aegis/core';

/**
 * Rejects requests whose X-Aegis-Signature is missing, stale, forged or replayed
 * (see @aegis/core AntiTamper). For server-to-server calls and webhooks, not
 * for browsers, which cannot hold the shared secret.
 *
 * The signature covers the exact body bytes, so mount it before any JSON
 * parser, or keep the raw body with `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`.
 */
export function aegisRequireSignature(secret: string, maxSkewSeconds = 300) {
  const antiTamper = new AntiTamper(secret, maxSkewSeconds);
  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let body: string;
    const raw = (req as any).rawBody ?? req.body;
    if (typeof raw === 'string' || Buffer.isBuffer(raw)) body = raw.toString('utf8');
    else if (req.readable) body = await readAll(req);
    else if (raw === undefined || (typeof raw === 'object' && raw !== null && Object.keys(raw).length === 0)) body = '';
    else { res.status(500).json({ error: 'raw body unavailable for signature check' }); return; }

    const result = antiTamper.verify({ method: req.method, path: req.originalUrl, body }, req.get(SIGNATURE_HEADER));
    if (!result.valid) { res.status(401).json({ error: 'invalid signature', reason: result.reason }); return; }
    (req as any).rawBody ??= body;
    next();
  };
  return Object.assign(middleware, { antiTamper });
}

function readAll(req: Request, limit = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { req.destroy(); reject(new Error('body too large')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
