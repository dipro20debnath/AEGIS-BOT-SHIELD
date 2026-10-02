export interface AegisClientConfig {
  siteKey: string;
  /** Base URL of the AEGIS server (default: this page's origin) */
  endpoint?: string;
  /** Path of the telemetry endpoint on the server */
  telemetryPath?: string;
  autoStart?: boolean;
  /** Attach the token to this site's own fetch/XHR requests */
  autoIntercept?: boolean;
  /** Extra origins (besides this page's) whose requests get the token */
  allowedOrigins?: string[];
  interceptHeaders?: string[];
  collectMouse?: boolean;
  collectKeyboard?: boolean;
  collectScroll?: boolean;
  collectTouch?: boolean;
  fingerprint?: boolean;
  detectHeadless?: boolean;
  /** Send a final telemetry report with sendBeacon when the page is hidden */
  beaconOnExit?: boolean;
  debug?: boolean;
}

/** Server response to a telemetry submission */
export interface TelemetryResponse {
  token: string;
  /** Token lifetime in seconds */
  expiresIn: number;
  verdict: 'allow' | 'challenge' | 'block' | 'monitor';
  score: number;
}

export interface HeadlessDetectionResult {
  isHeadless: boolean;
  confidence: number;
  tests: DetectionTest[];
  detectedCount: number;
  totalTests: number;
}

export interface DetectionTest {
  name: string;
  detected: boolean;
  confidence: number;
  details: string;
}

export interface ChallengeRequest {
  id: string;
  type: 'pow' | 'wasm' | 'interactive';
  payload: any;
  difficulty?: number;
}

export interface ChallengeResponse {
  id: string;
  solved: boolean;
  result?: any;
  error?: string;
  timeMs?: number;
}
