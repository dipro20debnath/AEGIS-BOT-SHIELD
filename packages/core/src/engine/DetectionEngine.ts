import { AegisRequest, AegisVerdict, AegisConfig, RiskScore } from '../types/index.js';
import { defaultConfig } from '../config/defaults.js';
import { RiskScorer } from './RiskScorer.js';

export class DetectionEngine {
  private config: AegisConfig;
  private riskScorer: RiskScorer;

  constructor(config?: Partial<AegisConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.riskScorer = new RiskScorer();
  }

  public async analyze(request: AegisRequest): Promise<AegisVerdict> {
    const riskScore = await this.calculateRiskScore(request);
    return this.determineVerdict(riskScore);
  }

  private async calculateRiskScore(request: AegisRequest): Promise<RiskScore> {
    // In a full implementation, this would aggregate signals from all modules.
    const score = 0; // Placeholder
    return { score, factors: {} };
  }

  private determineVerdict(riskScore: RiskScore): AegisVerdict {
    if (riskScore.score >= (this.config.blockThreshold || 80)) {
      return 'block';
    }
    if (riskScore.score >= (this.config.challengeThreshold || 50)) {
      return 'challenge';
    }
    return 'allow';
  }
}
