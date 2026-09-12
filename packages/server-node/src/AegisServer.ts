import express, { Express } from 'express';
import { createAegisRoutes } from './api/routes';
import { AegisServerConfig } from './types';

export class AegisServer {
    private app: Express;
    private config: AegisServerConfig;
    private server: any;

    constructor(config: AegisServerConfig) {
        this.config = config;
        this.app = express();
        
        this.app.use(express.json());
        this.app.use('/aegis', createAegisRoutes(this.config.secretKey));
    }

    public start(port: number = 8080): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(port, () => {
                console.log(`Aegis Microservice running on port ${port}`);
                resolve();
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }
}
