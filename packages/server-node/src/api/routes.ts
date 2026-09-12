import { Router, Request, Response } from 'express';
import { TokenVerifier } from '../verifier/TokenVerifier';

export function createAegisRoutes(secretKey: string): Router {
    const router = Router();
    const verifier = new TokenVerifier(secretKey);

    router.post('/v1/verify', (req: Request, res: Response) => {
        const { token, clientIp } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'Missing token' });
        }
        
        const result = verifier.verify(token, clientIp || req.ip);
        return res.json(result);
    });

    router.post('/v1/report', (req: Request, res: Response) => {
        // Here we would normally forward this to the ML Engine
        return res.json({ success: true, message: 'Activity reported' });
    });

    router.get('/v1/status', (req: Request, res: Response) => {
        return res.json({ status: 'healthy', version: '1.0.0' });
    });

    router.get('/v1/analytics', (req: Request, res: Response) => {
        return res.json({
            totalRequests: 0,
            blockedRequests: 0,
            challengedRequests: 0
        });
    });

    router.post('/v1/challenge', (req: Request, res: Response) => {
        // Issue a CAPTCHA or PoW challenge token
        return res.json({ 
            challengeId: 'ch_' + Date.now(),
            type: 'pow',
            difficulty: 4
        });
    });

    return router;
}
