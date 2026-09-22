import { IncomingMessage, ServerResponse } from 'http';
import { TokenVerifier } from '../TokenVerifier.js';
import { Logger } from '@aegis/core';

export interface AegisGenericOptions {
  siteKey: string;
  secretKey: string;
  protectedPaths?: string[];
  excludedPaths?: string[];
  blockAction?: 'reject' | 'challenge' | 'log';
  onBlock?: (req: IncomingMessage, res: ServerResponse, result: any) => void;
  onChallenge?: (req: IncomingMessage, res: ServerResponse, result: any) => void;
  tokenHeader?: string;
  logging?: boolean;
  thresholds?: { block: number; challenge: number };
}

export function aegisGeneric(options: AegisGenericOptions) {
  const verifier = new TokenVerifier(options.secretKey);
  const logger = new Logger('AegisGeneric');
  const tokenHeader = (options.tokenHeader || 'x-aegis-token').toLowerCase();
  const thresholds = options.thresholds || { block: 80, challenge: 50 };

  return async (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    try {
      const url = req.url || '/';
      if (options.excludedPaths?.some(p => url.startsWith(p))) { next(); return; }
      if (options.protectedPaths && !options.protectedPaths.some(p => url.startsWith(p))) { next(); return; }

      const token = req.headers[tokenHeader] as string | undefined;

      const aegisRequest = {
        ip: req.socket.remoteAddress || '0.0.0.0',
        headers: req.headers as Record<string, string>,
        method: req.method || 'GET',
        path: url,
        query: {},
        body: null,
        aegisToken: token,
        timestamp: Date.now(),
        requestId: req.headers['x-request-id'] as string || generateRequestId(),
      };

      const result = await verifier.verify(aegisRequest);

      (req as any).aegis = result;

      if (result.riskScore >= thresholds.block) {
        if (options.onBlock) { options.onBlock(req, res, result); return; }
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Request blocked by AEGIS Bot Shield', requestId: result.requestId }));
        return;
      }

      if (result.riskScore >= thresholds.challenge) {
        if (options.onChallenge) { options.onChallenge(req, res, result); return; }
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ challenge: true, type: 'pow', difficulty: 4, requestId: result.requestId }));
        return;
      }

      if (options.logging) {
        logger.info('Request analyzed', { path: url, ip: aegisRequest.ip, score: result.riskScore, verdict: result.verdict });
      }

      next();
    } catch (error) {
      logger.error('AEGIS Generic middleware error', error as Error);
      next();
    }
  };
}

function generateRequestId(): string {
  return `aegis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
