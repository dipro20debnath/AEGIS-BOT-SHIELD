import { RiskScore, DetectionSignal } from '../types/index.js';

/**
 * Multi-signal risk scoring engine that fuses detection signals
 * from all defense layers into a composite risk score.
 * 
 * Scoring algorithm:
 * 1. Group signals by category (network, protocol, behavioral, device, reputation)
 * 2. Apply category weights
 * 3. Apply signal-level weights and confidence
 * 4. Normalize to 0-100 scale
 * 5. Apply boosting for high-confidence critical signals
 */
export class RiskScorer {
  private categoryWeights: Record<string, number>;

  constructor(weights?: Partial<Record<string, number>>) {
    this.categoryWeights = {
      network: 0.20,
      protocol: 0.20,
      behavioral: 0.25,
      device: 0.20,
      reputation: 0.15,
      ...weights,
    };
  }

  /**
   * Calculate composite risk score from multiple detection signals.
   * Uses weighted signal fusion with confidence adjustment.
   */
  public calculateCompositeScore(signals: DetectionSignal[]): RiskScore {
    if (signals.length === 0) {
      return this.emptyScore();
    }

    // Group signals by category
    const grouped = this.groupByCategory(signals);
    
    // Calculate per-category scores
    const categories = {
      network: this.calculateCategoryScore(grouped['network'] || []),
      protocol: this.calculateCategoryScore(grouped['protocol'] || []),
      behavioral: this.calculateCategoryScore(grouped['behavioral'] || []),
      device: this.calculateCategoryScore(grouped['device'] || []),
      reputation: this.calculateCategoryScore(grouped['reputation'] || []),
    };

    // Weighted composite
    let compositeScore = 0;
    let totalWeight = 0;
    for (const [category, score] of Object.entries(categories)) {
      const weight = this.categoryWeights[category] || 0;
      compositeScore += score * weight;
      if (score > 0) totalWeight += weight;
    }

    // Normalize
    if (totalWeight > 0) {
      compositeScore = compositeScore / totalWeight;
    }

    // Apply critical signal boosting
    compositeScore = this.applyCriticalBoosting(compositeScore, signals);

    // Clamp to 0-100
    compositeScore = Math.min(100, Math.max(0, Math.round(compositeScore)));

    // Calculate confidence
    const confidence = this.calculateConfidence(signals);

    // Build factors map
    const factors: Record<string, number> = {};
    for (const signal of signals) {
      factors[signal.type] = signal.value * signal.confidence * signal.weight;
    }

    return { score: compositeScore, categories, factors, confidence };
  }

  private groupByCategory(signals: DetectionSignal[]): Record<string, DetectionSignal[]> {
    return signals.reduce((acc, signal) => {
      const category = signal.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(signal);
      return acc;
    }, {} as Record<string, DetectionSignal[]>);
  }

  private calculateCategoryScore(signals: DetectionSignal[]): number {
    if (signals.length === 0) return 0;
    let score = 0;
    let totalWeight = 0;
    for (const signal of signals) {
      const effectiveWeight = signal.weight * signal.confidence;
      score += signal.value * effectiveWeight;
      totalWeight += effectiveWeight;
    }
    return totalWeight > 0 ? score / totalWeight : 0;
  }

  private applyCriticalBoosting(baseScore: number, signals: DetectionSignal[]): number {
    let boostedScore = baseScore;

    // Headless browser boost
    const hasHeadless = signals.some(s => s.type.toLowerCase().includes('headless') && s.value > 50);
    if (hasHeadless) {
      boostedScore = Math.max(boostedScore, 85);
    }

    // High confidence critical signal boost
    const hasCritical = signals.some(s => s.value >= 95 && s.confidence >= 0.9);
    if (hasCritical) {
      boostedScore *= 1.20; // Boost by 20%
    }

    // Multiple high-risk signals boost
    const highRiskSignals = signals.filter(s => s.value >= 70);
    if (highRiskSignals.length >= 3) {
      boostedScore *= 1.10; // Boost by 10%
    }

    return boostedScore;
  }

  private calculateConfidence(signals: DetectionSignal[]): number {
    if (signals.length === 0) return 0;
    const totalConfidence = signals.reduce((sum, s) => sum + s.confidence, 0);
    return totalConfidence / signals.length;
  }

  public emptyScore(): RiskScore {
    return {
      score: 0,
      categories: {
        network: 0,
        protocol: 0,
        behavioral: 0,
        device: 0,
        reputation: 0,
      },
      factors: {},
      confidence: 0,
    };
  }
}
