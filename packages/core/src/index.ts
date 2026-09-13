// Core Types
export * from './types/index.js';

// Configuration
export { defaultConfig, mergeConfig } from './config/defaults.js';

// Engine
export { DetectionEngine } from './engine/DetectionEngine.js';
export { RiskScorer } from './engine/RiskScorer.js';

// Rate Limiting
export { TokenBucketLimiter } from './modules/rate-limiter/TokenBucketLimiter.js';
export { SlidingWindowLimiter } from './modules/rate-limiter/SlidingWindowLimiter.js';
export { AdaptiveRateLimiter } from './modules/rate-limiter/AdaptiveRateLimiter.js';

// IP Intelligence
export { IPAnalyzer } from './modules/ip-intelligence/IPAnalyzer.js';
export { GeoIPResolver } from './modules/ip-intelligence/GeoIPResolver.js';
export { ResidentialProxyDetector } from './modules/ip-intelligence/ResidentialProxyDetector.js';

// Fingerprinting
export { TLSFingerprinter } from './modules/fingerprint/TLSFingerprinter.js';
export { HeaderAnalyzer } from './modules/fingerprint/HeaderAnalyzer.js';
export { HTTP2Fingerprinter } from './modules/fingerprint/HTTP2Fingerprinter.js';

// Session
export { SessionManager } from './modules/session/SessionManager.js';

// Honeypot
export { HoneypotDetector } from './modules/honeypot/HoneypotDetector.js';

// Threat Intelligence
export { ThreatDatabase } from './modules/threat-intel/ThreatDatabase.js';

// Utilities
export { Logger } from './utils/logger.js';
export * from './utils/crypto.js';
