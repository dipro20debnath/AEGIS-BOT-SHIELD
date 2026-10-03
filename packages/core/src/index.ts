// Core Types
export * from './types/index.js';

// Configuration
export { defaultConfig, mergeConfig } from './config/defaults.js';

// Engine
export { DetectionEngine, analyzeBehavior, classifyThreats, SESSION_HEADER } from './engine/DetectionEngine.js';
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

// Security
export { InputValidator } from './security/InputValidator.js';
export type { InputFinding, InputThreat, InputValidatorOptions } from './security/InputValidator.js';
export { securityHeaders, DEFAULT_CSP } from './security/SecurityHeaders.js';
export type { SecurityHeaderOptions } from './security/SecurityHeaders.js';
export type { SignableRequest, VerifyResult } from './security/AntiTamper.js';
export { AntiTamper, signRequest, parseSignatureHeader, canonicalString, SIGNATURE_HEADER } from './security/AntiTamper.js';

// Live feeds and session patterns
export { TorExitNodeChecker } from './modules/ip-intelligence/TorExitNodeChecker.js';
export type { TorExitNodeCheckerOptions, TorListStatus } from './modules/ip-intelligence/TorExitNodeChecker.js';
export { ThreatFeedSync } from './modules/threat-intel/ThreatFeedSync.js';
export type { FeedName, FeedResult, ThreatFeedSyncOptions } from './modules/threat-intel/ThreatFeedSync.js';
export { FEED_URLS, parsePlainList, parseSpamhausDrop, isSpecialPurpose } from './modules/threat-intel/feeds.js';
export type { Fetcher, ParsedFeed } from './modules/threat-intel/feeds.js';
export { BotBehaviorAnalyzer, classifyRequest, longestSequentialRun } from './modules/session/BotBehaviorAnalyzer.js';
export type { BotBehaviorOptions, RequestKind } from './modules/session/BotBehaviorAnalyzer.js';
export { MemoryHardChallenger, POW_PREFIX } from './security/MemoryHardChallenge.js';
export type { PowChallenge, PowVerifyResult, MemoryHardOptions } from './security/MemoryHardChallenge.js';
