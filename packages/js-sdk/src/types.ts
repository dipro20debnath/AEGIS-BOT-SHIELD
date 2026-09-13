export interface AegisClientConfig {
  siteKey: string;
  endpoint?: string;
  autoStart?: boolean;
  autoIntercept?: boolean;
  interceptHeaders?: string[];
  collectMouse?: boolean;
  collectKeyboard?: boolean;
  collectScroll?: boolean;
  collectTouch?: boolean;
  fingerprint?: boolean;
  detectHeadless?: boolean;
  debug?: boolean;
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
