import type { Request, Response, NextFunction } from 'express';
import { AntiTamper, SIGNATURE_HEADER, AegisStore } from '@aegis/core';

/**
 * Rejects requests whose X-Aegis-Signature is missing, stale, forged or replayed
 * (see @aegis/core AntiTamper). For server-to-server calls and webhooks, not
 * for browsers, which cannot hold the shared secret.
 *
 * The signature covers the exact body bytes, so mount it before any JSON
 * parser, or keep the raw body with `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`.
 * Pass a shared store (RedisStore) when several instances receive the calls,
 * so a nonce used at one instance is rejected at all of them.
 */
export function aegisRequireSignature(secret: string, maxSkewSeconds = 300, store?: AegisStore) {
  const antiTamper = new AntiTamper(secret, maxSkewSeconds, store);
  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let body: string;
    const raw = (req as any).rawBody ?? req.body;
    if (typeof raw === 'string' || Buffer.isBuffer(raw)) body = raw.toString('utf8');
    else if (req.readable) body = await readAll(req);
    else if (raw === undefined || (typeof raw === 'object' && raw !== null && Object.keys(raw).length === 0)) body = '';
    else { res.status(500).json({ error: 'raw body unavailable for signature check' }); return; }

    let result;
    try {
      result = await antiTamper.verifyAsync({ method: req.method, path: req.originalUrl, body }, req.get(SIGNATURE_HEADER));
    } catch {
      res.status(503).json({ error: 'signature verification unavailable' });
      return;
    }
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
