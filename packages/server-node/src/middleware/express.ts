import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AegisMiddlewareOptions, VerificationResult, ProtectionMode } from '../types';
import { TokenVerifier } from '../verifier/TokenVerifier';

declare global {
    namespace Express {
        interface Request {
            aegis?: VerificationResult;
        }
    }
}

export function aegisProtect(options: AegisMiddlewareOptions): RequestHandler {
    const verifier = new TokenVerifier(options.config.secretKey);
    const failOpen = options.config.failOpen !== false;
    const mode = options.config.protectionMode || ProtectionMode.ENFORCE;

    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const token = req.header(options.config.tokenHeaderName || 'X-Aegis-Token') || 
                          req.cookies?.[options.config.tokenCookieName || 'aegis_token'];

            if (!token) {
                if (mode === ProtectionMode.ENFORCE) {
                    res.status(403).json({ error: 'Missing Aegis token' });
                    return;
                }
                next();
                return;
            }

            const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
            const result = verifier.verify(token, clientIp);
            req.aegis = result;

            if (mode === ProtectionMode.ENFORCE) {
                if (result.verdict === 'block') {
                    res.status(403).json({ error: 'Access denied by Aegis Bot Shield', reason: result.reason });
                    return;
                } else if (result.verdict === 'challenge') {
                    res.status(401).json({ error: 'Challenge required by Aegis Bot Shield' });
                    return;
                }
            }
            
            next();
        } catch (error) {
            if (failOpen) {
                next();
            } else {
                res.status(500).json({ error: 'Aegis Bot Shield encountered an error' });
            }
        }
    };
}
