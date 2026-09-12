export enum ProtectionMode {
    MONITOR = 'monitor',
    ENFORCE = 'enforce'
}

export interface AegisServerConfig {
    secretKey: string;
    protectionMode?: ProtectionMode;
    failOpen?: boolean;
    tokenHeaderName?: string;
    tokenCookieName?: string;
}

export interface AegisMiddlewareOptions {
    config: AegisServerConfig;
    routesToProtect?: string[];
    routesToExclude?: string[];
}

export interface VerificationResult {
    valid: boolean;
    verdict: 'allow' | 'block' | 'challenge';
    riskScore?: number;
    reason?: string;
}
