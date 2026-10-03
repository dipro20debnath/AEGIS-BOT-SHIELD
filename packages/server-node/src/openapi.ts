/**
 * The OpenAPI document of the AEGIS endpoints (contracts/openapi.json, copied
 * here by `npm run sync:openapi`; a test checks the copy is current) and a
 * Swagger UI page for it.
 */
import type { Request, Response } from 'express';
import spec from './openapi.json';

export const openapiSpec = spec as Record<string, unknown>;

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.1';

/** Swagger UI pinned to one version with subresource-integrity hashes. */
export function swaggerUiHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AEGIS BOT SHIELD API</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css"
    integrity="sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"
    integrity="sha384-ZPehFMQommnnuaZ4rpxgkgTT2DKFVp4hZC/7pLit+9Lek9T1YGSo23eHFbvNkXkw" crossorigin="anonymous"></script>
  <script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui' });</script>
</body>
</html>`;
}

/** The document with this server first in `servers`, so Swagger UI's "Try it out" calls it. */
export function serveOpenapi(_req: Request, res: Response): void {
  const servers = (openapiSpec.servers as Array<Record<string, string>> | undefined) ?? [];
  res.json({ ...openapiSpec, servers: [{ url: '/', description: 'This server' }, ...servers] });
}

export function serveSwaggerUi(_req: Request, res: Response): void {
  res.type('html').send(swaggerUiHtml('/aegis/openapi.json'));
}
