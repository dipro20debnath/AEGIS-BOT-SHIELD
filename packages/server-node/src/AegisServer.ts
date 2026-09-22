import express, { Express } from 'express';
import { aegisExpress, AegisExpressOptions } from './middleware/express.js';
import { aegisRoutes } from './routes.js';
import { Logger } from '@aegis/core';

export class AegisServer {
  private app: Express;
  private logger: Logger;
  private options: AegisExpressOptions;

  constructor(options: AegisExpressOptions) {
    this.options = options;
    this.app = express();
    this.logger = new Logger('AegisServer');

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(aegisExpress(this.options));
  }

  private setupRoutes() {
    this.app.use(aegisRoutes(this.options));
  }

  public getApp(): Express {
    return this.app;
  }

  public start(port: number = 3000): void {
    this.app.listen(port, () => {
      this.logger.info(`AEGIS Server listening on port ${port}`);
    });
  }
}
