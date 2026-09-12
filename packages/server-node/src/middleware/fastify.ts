import { AegisMiddlewareOptions, ProtectionMode } from '../types';
import { TokenVerifier } from '../verifier/TokenVerifier';

export function aegisFastifyPlugin(fastify: any, options: AegisMiddlewareOptions, done: () => void) {
    const verifier = new TokenVerifier(options.config.secretKey);
    const failOpen = options.config.failOpen !== false;
    const mode = options.config.protectionMode || ProtectionMode.ENFORCE;

    fastify.addHook('onRequest', (request: any, reply: any, next: any) => {
        try {
            const token = request.headers[options.config.tokenHeaderName?.toLowerCase() || 'x-aegis-token'] || 
                          request.cookies?.[options.config.tokenCookieName || 'aegis_token'];

            if (!token) {
                if (mode === ProtectionMode.ENFORCE) {
                    reply.code(403).send({ error: 'Missing Aegis token' });
                    return;
                }
                next();
                return;
            }

            const clientIp = request.ip || 'unknown';
            const result = verifier.verify(token, clientIp);
            request.aegis = result;

            if (mode === ProtectionMode.ENFORCE) {
                if (result.verdict === 'block') {
                    reply.code(403).send({ error: 'Access denied by Aegis Bot Shield', reason: result.reason });
                    return;
                } else if (result.verdict === 'challenge') {
                    reply.code(401).send({ error: 'Challenge required by Aegis Bot Shield' });
                    return;
                }
            }
            
            next();
        } catch (error) {
            if (failOpen) {
                next();
            } else {
                reply.code(500).send({ error: 'Aegis Bot Shield encountered an error' });
            }
        }
    });

    done();
}
