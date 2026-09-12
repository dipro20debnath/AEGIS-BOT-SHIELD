import { AegisConfig } from '../types/index.js';

export const defaultConfig: AegisConfig = {
  redisUrl: 'redis://localhost:6379',
  enableThreatIntel: true,
  blockThreshold: 80,
  challengeThreshold: 50,
};
