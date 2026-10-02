import type { Request, Response, NextFunction } from 'express';
import { securityHeaders, SecurityHeaderOptions } from '@aegis/core';

/**
 * Sets CSP, HSTS, X-Frame-Options and related headers on every response.
 * Works with Express and any Connect-style server (it only calls setHeader).
 *
 * @example app.use(aegisSecurityHeaders({ contentSecurityPolicy: "default-src 'self'" }))
 */
export function aegisSecurityHeaders(options: SecurityHeaderOptions = {}) {
  const headers = Object.entries(securityHeaders(options));
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const [name, value] of headers) {
      if (!res.getHeader(name)) res.setHeader(name, value);
    }
    next();
  };
}
