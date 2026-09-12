/**
 * Configuration options for the AegisClient.
 */
export interface AegisClientConfig {
  endpoint?: string;
  siteKey: string;
  autoIntercept?: boolean;
  collectors?: {
    mouse?: boolean;
    keyboard?: boolean;
    scroll?: boolean;
    touch?: boolean;
  };
  fingerprinting?: boolean;
}

export interface CollectorData {
  timestamp: number;
  type: string;
  data: any;
}

export interface BehavioralSignals {
  mouse?: any;
  keyboard?: any;
  scroll?: any;
  touch?: any;
}

export interface DeviceInfo {
  canvas?: string;
  webgl?: string;
  audio?: string;
  fonts?: string[];
  screen?: any;
}

export interface ChallengeResult {
  challengeId: string;
  solution: any;
  duration: number;
}
