import express, { Express } from 'express';
import type { Server } from 'http';
import { Logger } from '@aegis/core';
import { AegisNode } from './AegisNode.js';
import { aegisExpress, AegisExpressOptions } from './middleware/express.js';
import { aegisRoutes } from './routes.js';
import { attachLiveFeed, LiveFeed } from './live.js';

/** Standalone Express app with the AEGIS middleware, status API (REST + GraphQL) and live feed. */
export class AegisServer {
  private app: Express;
  private logger = new Logger('AegisServer');
  readonly aegis: AegisNode;
  live?: LiveFeed;

  constructor(options: AegisExpressOptions) {
    this.aegis = new AegisNode({ ...options, excludedPaths: [...(options.excludedPaths ?? ['/health']), '/aegis/'] });
    this.app = express();
    this.app.set('trust proxy', false);
    this.app.use(express.json({ limit: '64kb' }));
    this.app.use(aegisExpress(options, this.aegis));
    this.app.use(aegisRoutes(this.aegis));
  }

  public getApp(): Express {
    return this.app;
  }

  public start(port: number = 3000): Server {
    const server = this.app.listen(port, () => {
      this.logger.info(`AEGIS Server listening on port ${port}`);
    });
    this.live = attachLiveFeed(server, this.aegis);
    return server;
  }
}
