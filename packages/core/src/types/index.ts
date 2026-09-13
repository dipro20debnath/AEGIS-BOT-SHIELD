// === Core Configuration ===
export interface AegisConfig {
  /** Unique site identifier */
  siteKey: string;
  /** Secret key for token signing */
  secretKey: string;
  /** Redis URL for distributed state */
  redisUrl?: string;
  /** Protection mode */
  mode: 'monitor' | 'enforce' | 'strict';
  /** Risk score thresholds */
  thresholds: {
    block: number;    // 0-100, default 80
    challenge: number; // 0-100, default 50
    monitor: number;   // 0-100, default 20
  };
  /** Rate limiting configuration */
  rateLimiting: RateLimitConfig;
  /** IP intelligence configuration */
  ipIntelligence: IPIntelConfig;
  /** Behavioral analysis configuration */
  behavioral: BehavioralConfig;
  /** Challenge configuration */
  challenges: ChallengeConfig;
  /** Logging configuration */
  logging: LogConfig;
  /** Modules to enable/disable */
  modules: ModuleConfig;
}

export interface RateLimitConfig {
  enabled: boolean;
  /** Requests per window */
  maxRequests: number;
  /** Window size in ms */
  windowMs: number;
  /** Per-IP bucket capacity */
  perIpCapacity: number;
  /** Per-IP refill rate (tokens/second) */
  perIpRefillRate: number;
  /** Per-endpoint limits */
  endpointLimits: Record<string, { maxRequests: number; windowMs: number }>;
  /** Adaptive rate limiting */
  adaptive: { enabled: boolean; sensitivityFactor: number };
}

export interface IPIntelConfig {
  enabled: boolean;
  /** Block known VPN providers */
  blockVPN: boolean;
  /** Block Tor exit nodes */
  blockTor: boolean;
  /** Block datacenter IPs */
  blockDatacenter: boolean;
  /** Detect residential proxies */
  detectResidentialProxy: boolean;
  /** Custom blocklist */
  blocklist: string[];
  /** Custom allowlist */
  allowlist: string[];
  /** AbuseIPDB API key */
  abuseIpDbKey?: string;
}

export interface BehavioralConfig {
  enabled: boolean;
  /** Minimum signals before scoring */
  minSignals: number;
  /** Signal weights for scoring */
  weights: {
    mouse: number;
    keyboard: number;
    scroll: number;
    touch: number;
    device: number;
    network: number;
  };
}

export interface ChallengeConfig {
  enabled: boolean;
  /** Default challenge type */
  defaultType: ChallengeType;
  /** PoW difficulty (number of leading zeros) */
  powDifficulty: number;
  /** Challenge timeout in ms */
  timeoutMs: number;
  /** Grace period after solved challenge (ms) */
  gracePeriodMs: number;
  /** Enable WASM challenges */
  wasmEnabled: boolean;
  /** Enable Private Access Tokens */
  patEnabled: boolean;
}

export interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Structured JSON output */
  structured: boolean;
  /** Include performance timing */
  timing: boolean;
}

export interface ModuleConfig {
  rateLimiter: boolean;
  ipIntelligence: boolean;
  tlsFingerprint: boolean;
  headerAnalysis: boolean;
  http2Fingerprint: boolean;
  sessionTracking: boolean;
  honeypot: boolean;
  threatIntel: boolean;
  behavioral: boolean;
  challenges: boolean;
}

// === Request & Response ===
export interface AegisRequest {
  /** Client IP address */
  ip: string;
  /** HTTP headers */
  headers: Record<string, string | string[] | undefined>;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Query parameters */
  query?: Record<string, string>;
  /** Request body (for POST analysis) */
  body?: unknown;
  /** TLS information */
  tls?: TLSInfo;
  /** HTTP/2 information */
  http2?: HTTP2Info;
  /** Session token from client SDK */
  aegisToken?: string;
  /** Client behavioral data (from JS SDK token) */
  behavioralData?: BehavioralPayload;
  /** Request timestamp */
  timestamp: number;
  /** Unique request ID */
  requestId: string;
}

export interface TLSInfo {
  /** JA3 fingerprint hash */
  ja3?: string;
  /** JA4 fingerprint (latest standard) */
  ja4?: string;
  /** JA4S server fingerprint */
  ja4s?: string;
  /** JA4H HTTP fingerprint */
  ja4h?: string;
  /** JA4T TCP fingerprint */
  ja4t?: string;
  /** JA4L latency fingerprint */
  ja4l?: string;
  /** JA4X certificate fingerprint */
  ja4x?: string;
  /** TLS version */
  version: string;
  /** Cipher suite */
  cipher: string;
  /** ALPN protocol */
  alpn?: string;
  /** SNI hostname */
  sni?: string;
  /** Client certificate info */
  clientCert?: { issuer: string; subject: string };
}

export interface HTTP2Info {
  /** SETTINGS frame parameters */
  settings?: Record<string, number>;
  /** Priority tree */
  priorityFrames?: Array<{ streamId: number; weight: number; dependency: number }>;
  /** Pseudo-header order */
  pseudoHeaderOrder?: string[];
}

export interface BehavioralPayload {
  /** Mouse movement data */
  mouse?: MouseData;
  /** Keyboard data */
  keyboard?: KeyboardData;
  /** Scroll data */
  scroll?: ScrollData;
  /** Touch data */
  touch?: TouchData;
  /** Device fingerprint */
  fingerprint?: string;
  /** Headless browser detected */
  isHeadless?: boolean;
  /** Anti-detect browser detected */
  isAntiDetect?: boolean;
  /** Challenge result */
  challengeResult?: ChallengeResult;
  /** Collection timestamp */
  timestamp: number;
}

export interface MouseData {
  /** Total events collected */
  eventCount: number;
  /** Average velocity (px/ms) */
  avgVelocity: number;
  /** Velocity standard deviation */
  velocityStd: number;
  /** Average acceleration */
  avgAcceleration: number;
  /** Average jerk (rate of acceleration change) */
  avgJerk: number;
  /** Curvature score (0-1, 1=perfectly straight=suspicious) */
  straightnessIndex: number;
  /** Click count */
  clickCount: number;
  /** Average click precision (distance from target center) */
  clickPrecision: number;
  /** Micro-tremor frequency (Hz) - humans have 8-12Hz tremor */
  microTremorFreq: number;
  /** Fitts's Law R² correlation */
  fittsLawR2: number;
  /** Path samples [[x,y,t], ...] */
  samples: Array<[number, number, number]>;
}

export interface KeyboardData {
  /** Total key events */
  eventCount: number;
  /** Average dwell time (key hold duration in ms) */
  avgDwellTime: number;
  /** Dwell time standard deviation */
  dwellTimeStd: number;
  /** Average flight time (between keys in ms) */
  avgFlightTime: number;
  /** Flight time standard deviation */
  flightTimeStd: number;
  /** Typing speed (chars/min) */
  typingSpeed: number;
  /** Paste events detected */
  pasteCount: number;
  /** Backspace/correction ratio */
  correctionRatio: number;
  /** Typing cadence entropy (higher = more human-like) */
  cadenceEntropy: number;
}

export interface ScrollData {
  /** Total scroll events */
  eventCount: number;
  /** Average scroll velocity */
  avgVelocity: number;
  /** Direction change count */
  directionChanges: number;
  /** Max scroll depth (0-1) */
  maxDepth: number;
  /** Is momentum scrolling detected (natural) */
  hasMomentum: boolean;
  /** Scroll type distribution */
  scrollTypes: { wheel: number; touch: number; programmatic: number };
}

export interface TouchData {
  eventCount: number;
  avgPressure: number;
  avgRadius: number;
  multiTouchCount: number;
  swipeVelocity: number;
  tapPrecision: number;
}

// === Verdict & Scoring ===
export type AegisVerdict = 'allow' | 'block' | 'challenge' | 'monitor';

export type ChallengeType = 'pow' | 'wasm' | 'pat' | 'interactive' | 'invisible';

export interface AegisResult {
  /** Final verdict */
  verdict: AegisVerdict;
  /** Risk score 0-100 */
  riskScore: RiskScore;
  /** If challenge, which type */
  challengeType?: ChallengeType;
  /** Human-readable reason */
  reason: string;
  /** Detailed signal breakdown */
  signals: DetectionSignal[];
  /** Matched threat categories */
  threats: ThreatCategory[];
  /** Processing time in ms */
  processingTimeMs: number;
  /** Request ID for correlation */
  requestId: string;
  /** Timestamp */
  timestamp: number;
}

export interface RiskScore {
  /** Composite score 0-100 */
  score: number;
  /** Per-category scores */
  categories: {
    network: number;
    protocol: number;
    behavioral: number;
    device: number;
    reputation: number;
  };
  /** Individual factor contributions */
  factors: Record<string, number>;
  /** Confidence level 0-1 */
  confidence: number;
}

export interface DetectionSignal {
  /** Signal category */
  category: 'network' | 'protocol' | 'behavioral' | 'device' | 'reputation' | 'challenge';
  /** Signal type name */
  type: string;
  /** Signal value 0-100 */
  value: number;
  /** Confidence 0-1 */
  confidence: number;
  /** Human-readable description */
  description: string;
  /** Weight for scoring */
  weight: number;
}

export interface ChallengeResult {
  type: ChallengeType;
  solved: boolean;
  solutionTimeMs: number;
  nonce: string;
  solution: string;
  timestamp: number;
}

// === OWASP OAT Threat Categories ===
export enum ThreatCategory {
  OAT_001_CARDING = 'OAT-001: Carding',
  OAT_002_TOKEN_CRACKING = 'OAT-002: Token Cracking',
  OAT_003_AD_FRAUD = 'OAT-003: Ad Fraud',
  OAT_004_FINGERPRINTING = 'OAT-004: Fingerprinting',
  OAT_005_SCALPING = 'OAT-005: Scalping',
  OAT_006_EXPEDITING = 'OAT-006: Expediting',
  OAT_007_CREDENTIAL_CRACKING = 'OAT-007: Credential Cracking',
  OAT_008_CREDENTIAL_STUFFING = 'OAT-008: Credential Stuffing',
  OAT_009_CAPTCHA_DEFEAT = 'OAT-009: CAPTCHA Defeat',
  OAT_010_CARD_CRACKING = 'OAT-010: Card Cracking',
  OAT_011_SCRAPING = 'OAT-011: Scraping',
  OAT_012_CASHING_OUT = 'OAT-012: Cashing Out',
  OAT_013_SNIPING = 'OAT-013: Sniping',
  OAT_014_VULNERABILITY_SCANNING = 'OAT-014: Vulnerability Scanning',
  OAT_015_DENIAL_OF_SERVICE = 'OAT-015: Denial of Service',
  OAT_016_SKEWING = 'OAT-016: Skewing',
  OAT_017_SPAMMING = 'OAT-017: Spamming',
  OAT_018_FOOTPRINTING = 'OAT-018: Footprinting',
  OAT_019_ACCOUNT_CREATION = 'OAT-019: Account Creation',
  OAT_020_ACCOUNT_AGGREGATION = 'OAT-020: Account Aggregation',
  OAT_021_DENIAL_OF_INVENTORY = 'OAT-021: Denial of Inventory',
}

// === Session & IP Intelligence ===
export interface SessionInfo {
  id: string;
  createdAt: number;
  lastActivity: number;
  requestCount: number;
  uniquePaths: Set<string>;
  riskHistory: number[];
  verdictHistory: AegisVerdict[];
  behavioralProfile: BehavioralProfile;
  ipAddress: string;
  deviceFingerprint?: string;
  reputation: number; // 0-100
}

export interface IPIntelligence {
  ip: string;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  isResidentialProxy: boolean;
  isBogon: boolean;
  country?: string;
  city?: string;
  asn?: number;
  asnOrg?: string;
  reputation: number; // 0-100
  riskFactors: string[];
  lastSeen?: number;
  requestCount: number;
}

export interface DeviceFingerprint {
  /** JA3/JA4 TLS fingerprint */
  tlsFingerprint?: string;
  /** User-Agent string */
  userAgent: string;
  /** Client Hints (Sec-CH-UA) */
  clientHints?: ClientHints;
  /** HTTP version */
  httpVersion: string;
  /** Canvas hash from JS SDK */
  canvasHash?: string;
  /** WebGL fingerprint */
  webglHash?: string;
  /** Audio fingerprint */
  audioHash?: string;
  /** Screen info */
  screen?: { width: number; height: number; colorDepth: number; pixelRatio: number };
  /** Hardware concurrency */
  hardwareConcurrency?: number;
  /** Device memory (GB) */
  deviceMemory?: number;
  /** Platform */
  platform?: string;
  /** Timezone */
  timezone?: string;
  /** Language */
  language?: string;
  /** Composite hash */
  compositeHash: string;
}

export interface ClientHints {
  brand?: string;
  version?: string;
  mobile?: boolean;
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  model?: string;
  fullVersionList?: Array<{ brand: string; version: string }>;
}

export interface BehavioralProfile {
  /** Request rate (req/min) */
  requestRate: number;
  /** Path variability (unique paths / total requests) */
  pathVariability: number;
  /** Average time between requests (ms) */
  avgInterRequestTime: number;
  /** Inter-request time standard deviation */
  interRequestTimeStd: number;
  /** Resource loading ratio (CSS/JS/images loaded vs pages) */
  resourceLoadRatio: number;
  /** Session duration so far (ms) */
  sessionDuration: number;
  /** Has JavaScript execution evidence */
  hasJsExecution: boolean;
  /** Cookie acceptance */
  acceptsCookies: boolean;
}

// === Events ===
export type AegisEventType = 
  | 'request.analyzed'
  | 'request.blocked'
  | 'request.challenged'
  | 'challenge.issued'
  | 'challenge.solved'
  | 'challenge.failed'
  | 'threat.detected'
  | 'session.created'
  | 'session.flagged'
  | 'ip.blocked'
  | 'ip.unblocked'
  | 'config.updated';

export interface AegisEvent {
  type: AegisEventType;
  timestamp: number;
  requestId?: string;
  data: Record<string, unknown>;
}

export type AegisEventHandler = (event: AegisEvent) => void;
