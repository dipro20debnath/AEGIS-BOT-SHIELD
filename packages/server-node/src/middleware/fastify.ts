import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { TokenVerifier } from '../TokenVerifier.js';
import { Logger } from '@aegis/core';

export interface AegisFastifyOptions {
  siteKey: string;
  secretKey: string;
  protectedPaths?: string[];
  excludedPaths?: string[];
  blockAction?: 'reject' | 'challenge' | 'log';
  onBlock?: (req: FastifyRequest, reply: FastifyReply, result: any) => void | Promise<void>;
  onChallenge?: (req: FastifyRequest, reply: FastifyReply, result: any) => void | Promise<void>;
  tokenHeader?: string;
  logging?: boolean;
  thresholds?: { block: number; challenge: number };
}

const aegisFastifyPlugin: FastifyPluginAsync<AegisFastifyOptions> = async (
  fastify: FastifyInstance,
  options: AegisFastifyOptions
) => {
  const verifier = new TokenVerifier(options.secretKey);
  const logger = new Logger('AegisFastify');
  const tokenHeader = options.tokenHeader || 'x-aegis-token';
  const thresholds = options.thresholds || { block: 80, challenge: 50 };

  fastify.decorateRequest('aegis', null);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const url = request.url;
      if (options.excludedPaths?.some(p => url.startsWith(p))) return;
      if (options.protectedPaths && !options.protectedPaths.some(p => url.startsWith(p))) return;

      const token = request.headers[tokenHeader] as string | undefined;

      const aegisRequest = {
        ip: request.ip,
        headers: request.headers as Record<string, string>,
        method: request.method,
        path: url,
        query: request.query as Record<string, string>,
        body: request.body,
        aegisToken: token,
        timestamp: Date.now(),
        requestId: request.headers['x-request-id'] as string || generateRequestId(),
      };

      const result = await verifier.verify(aegisRequest);
      
      // @ts-ignore
      request.aegis = result;

      if (result.riskScore >= thresholds.block) {
        if (options.onBlock) { await options.onBlock(request, reply, result); return; }
        reply.code(403).send({ error: 'Request blocked by AEGIS Bot Shield', requestId: result.requestId });
        return reply;
      }

      if (result.riskScore >= thresholds.challenge) {
        if (options.onChallenge) { await options.onChallenge(request, reply, result); return; }
        reply.code(429).send({ challenge: true, type: 'pow', difficulty: 4, requestId: result.requestId });
        return reply;
      }

      if (options.logging) {
        logger.info('Request analyzed', { path: url, ip: aegisRequest.ip, score: result.riskScore, verdict: result.verdict });
      }

    } catch (error) {
      logger.error('AEGIS Fastify middleware error', error as Error);
    }
  });
};

function generateRequestId(): string {
  return `aegis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const aegisFastify = fp(aegisFastifyPlugin, {
  name: '@aegis/fastify'
});
