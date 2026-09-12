import { RiskScore, DetectionSignal } from '../types/index.js';

export class RiskScorer {
  public calculateCompositeScore(signals: DetectionSignal[]): RiskScore {
    let score = 0;
    const factors: Record<string, number> = {};

    for (const signal of signals) {
      const weightedScore = signal.value * signal.confidence;
      score += weightedScore;
      factors[signal.type] = weightedScore;
    }

    // Normalize score to 0-100
    score = Math.min(100, Math.max(0, score));

    return { score, factors };
  }
}
