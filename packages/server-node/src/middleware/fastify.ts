import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AegisNode, AegisNodeOptions, parseCookies } from '../AegisNode.js';

declare module 'fastify' {
  interface FastifyRequest {
    aegis: import('../AegisNode.js').AegisDecision | null;
  }
}

const plugin: FastifyPluginAsync<AegisNodeOptions> = async (fastify: FastifyInstance, options: AegisNodeOptions) => {
  const aegis = new AegisNode(options);
  fastify.decorateRequest('aegis', null);
  fastify.addHook('onClose', async () => aegis.shutdown());
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    aegis.recordResponse(request.aegis ?? undefined, reply.statusCode);
  });

  fastify.post(aegis.options.telemetryPath, { bodyLimit: aegis.options.maxTelemetryBytes }, async (request, reply) => {
    const r = await aegis.handleTelemetry({
      method: 'POST', path: aegis.options.telemetryPath, ip: request.ip, headers: request.headers,
      cookies: parseCookies(request.headers.cookie), body: request.body,
    });
    return reply.code(r.status).headers(r.headers).send(r.body);
  });

  const challenge = async (request: FastifyRequest, reply: FastifyReply) => {
    const r = await aegis.handleChallenge({
      method: request.method, path: aegis.options.challengePath, ip: request.ip, headers: request.headers,
      cookies: parseCookies(request.headers.cookie), body: request.body,
    });
    return reply.code(r.status).headers(r.headers).send(r.body);
  };
  fastify.get(aegis.options.challengePath, challenge);
  fastify.post(aegis.options.challengePath, { bodyLimit: 4096 }, challenge);

  // preHandler runs after body parsing, so honeypot checks can see form fields
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];
    if (aegis.isAegisEndpoint(request.method, path) || !aegis.shouldProtect(path)) return;
    try {
      const { decision, headers } = await aegis.evaluate({
        method: request.method, path, ip: request.ip, headers: request.headers,
        cookies: parseCookies(request.headers.cookie), query: request.query as Record<string, unknown>, body: request.body,
      });
      request.aegis = decision;
      reply.headers(headers);
      if (decision.verdict === 'block' || decision.verdict === 'challenge') {
        const r = aegis.denial(decision);
        return reply.code(r.status).headers(r.headers).send(r.body);
      }
    } catch {
      // fail open
    }
  });
};

/** Fastify plugin: `fastify.register(aegisFastify, { siteKey, secretKey, ... })` */
export const aegisFastify = fp(plugin, { name: 'aegis-bot-shield', fastify: '>=4' });
