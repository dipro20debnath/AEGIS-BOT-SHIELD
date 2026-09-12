import { AegisMiddlewareOptions, ProtectionMode, VerificationResult } from '../types';
import { TokenVerifier } from '../verifier/TokenVerifier';

export function createGenericAegisMiddleware(options: AegisMiddlewareOptions) {
    const verifier = new TokenVerifier(options.config.secretKey);
    const failOpen = options.config.failOpen !== false;
    const mode = options.config.protectionMode || ProtectionMode.ENFORCE;
    const headerName = options.config.tokenHeaderName?.toLowerCase() || 'x-aegis-token';

    return function(req: any, res: any, next: (err?: any) => void) {
        try {
            // Attempt to extract token generically
            const token = (req.headers && req.headers[headerName]) || 
                          (req.cookies && req.cookies[options.config.tokenCookieName || 'aegis_token']);

            if (!token) {
                if (mode === ProtectionMode.ENFORCE) {
                    if (res.status && res.json) {
                        res.status(403).json({ error: 'Missing Aegis token' });
                    } else if (res.writeHead) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing Aegis token' }));
                    }
                    return;
                }
                next();
                return;
            }

            const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
            const result = verifier.verify(token as string, clientIp);
            req.aegis = result;

            if (mode === ProtectionMode.ENFORCE) {
                if (result.verdict === 'block') {
                    if (res.status && res.json) {
                        res.status(403).json({ error: 'Access denied', reason: result.reason });
                    } else {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Access denied', reason: result.reason }));
                    }
                    return;
                } else if (result.verdict === 'challenge') {
                    if (res.status && res.json) {
                        res.status(401).json({ error: 'Challenge required' });
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Challenge required' }));
                    }
                    return;
                }
            }
            
            next();
        } catch (error) {
            if (failOpen) {
                next();
            } else {
                if (res.status && res.json) {
                    res.status(500).json({ error: 'Aegis encountered an error' });
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Aegis encountered an error' }));
                }
            }
        }
    };
}
