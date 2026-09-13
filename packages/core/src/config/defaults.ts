import { AegisConfig } from '../types/index.js';

export const defaultConfig: AegisConfig = {
  siteKey: '',
  secretKey: '',
  mode: 'monitor',
  thresholds: {
    block: 80,
    challenge: 50,
    monitor: 20,
  },
  rateLimiting: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60_000,
    perIpCapacity: 50,
    perIpRefillRate: 5,
    endpointLimits: {
      '/login': { maxRequests: 5, windowMs: 60_000 },
      '/register': { maxRequests: 3, windowMs: 60_000 },
      '/api/checkout': { maxRequests: 10, windowMs: 60_000 },
    },
    adaptive: { enabled: true, sensitivityFactor: 1.0 },
  },
  ipIntelligence: {
    enabled: true,
    blockVPN: false,
    blockTor: true,
    blockDatacenter: false,
    detectResidentialProxy: true,
    blocklist: [],
    allowlist: [],
  },
  behavioral: {
    enabled: true,
    minSignals: 3,
    weights: {
      mouse: 0.25,
      keyboard: 0.20,
      scroll: 0.10,
      touch: 0.10,
      device: 0.20,
      network: 0.15,
    },
  },
  challenges: {
    enabled: true,
    defaultType: 'pow',
    powDifficulty: 4,
    timeoutMs: 30_000,
    gracePeriodMs: 30 * 60_000,
    wasmEnabled: true,
    patEnabled: true,
  },
  logging: {
    level: 'info',
    structured: true,
    timing: true,
  },
  modules: {
    rateLimiter: true,
    ipIntelligence: true,
    tlsFingerprint: true,
    headerAnalysis: true,
    http2Fingerprint: true,
    sessionTracking: true,
    honeypot: true,
    threatIntel: true,
    behavioral: true,
    challenges: true,
  },
};

/** Merge user config with defaults (deep merge) */
export function mergeConfig(userConfig: Partial<AegisConfig>): AegisConfig {
  return deepMerge(defaultConfig, userConfig) as AegisConfig;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
