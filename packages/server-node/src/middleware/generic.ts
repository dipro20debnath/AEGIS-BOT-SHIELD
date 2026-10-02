import type { IncomingMessage, ServerResponse } from 'http';
import { AegisNode, AegisNodeOptions, HandlerResponse, parseCookies } from '../AegisNode.js';

function send(res: ServerResponse, r: HandlerResponse): void {
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(r.headers)) res.setHeader(name, value);
  res.end(JSON.stringify(r.body));
}

/** Connect-style middleware for plain `http` servers and compatible frameworks. */
export function aegisGeneric(options: AegisNodeOptions, shared?: AegisNode) {
  const aegis = shared ?? new AegisNode(options);

  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): Promise<void> => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method || 'GET';
      const info = { method, path, ip: req.socket.remoteAddress || '', headers: req.headers, cookies: parseCookies(req.headers.cookie) };

      if (aegis.isTelemetryRequest(method, path)) {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > aegis.options.maxTelemetryBytes) {
            send(res, { status: 413, body: { error: 'telemetry too large' }, headers: {} });
            return;
          }
          chunks.push(chunk as Buffer);
        }
        send(res, await aegis.handleTelemetry({ ...info, body: Buffer.concat(chunks).toString('utf8') }));
        return;
      }
      if (!aegis.shouldProtect(path)) { next(); return; }

      const { decision, headers } = await aegis.evaluate({ ...info, query: Object.fromEntries(url.searchParams) });
      (req as any).aegis = decision;
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      res.on('finish', () => aegis.recordResponse(decision, res.statusCode));
      if (decision.verdict === 'block' || decision.verdict === 'challenge') {
        send(res, aegis.denial(decision));
        return;
      }
      next();
    } catch (error) {
      next();
    }
  };
}
