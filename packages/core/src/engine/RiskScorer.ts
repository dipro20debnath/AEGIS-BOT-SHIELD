import { RiskScore, DetectionSignal } from '../types/index.js';

/**
 * Multi-signal risk scoring engine that fuses detection signals
 * from all defense layers into a composite risk score.
 *
 * Scoring algorithm:
 * 1. Group signals by category (network, protocol, behavioral, device, reputation)
 * 2. Per category: weighted mean of signal values, each discounted by confidence
 * 3. Across categories: noisy-OR, score = 100 * (1 - prod(1 - s_c / 100)).
 *    Categories are treated as independent layers, so evidence from another
 *    layer can only raise the score (a weighted average would let a weak
 *    signal in one layer dilute a decisive one in another).
 * 4. Apply boosting for high-confidence critical signals, clamp to 0-100
 */
export class RiskScorer {
  /** Per-category multipliers in [0, 1] (default 1), e.g. 0.5 for protocol signals behind a proxy. */
  private categoryMultipliers: Record<string, number>;

  constructor(multipliers?: Partial<Record<string, number>>) {
    this.categoryMultipliers = {
      network: 1,
      protocol: 1,
      behavioral: 1,
      device: 1,
      reputation: 1,
      ...multipliers,
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

    // Noisy-OR across independent categories
    let benign = 1;
    for (const [category, score] of Object.entries(categories)) {
      const multiplier = this.categoryMultipliers[category] ?? 1;
      benign *= 1 - Math.min(1, Math.max(0, (score * multiplier) / 100));
    }
    let compositeScore = 100 * (1 - benign);

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

  /**
   * Weighted mean of signal values, each discounted by its confidence.
   * (Dividing by the confidence-weighted total instead would cancel confidence
   * out for a lone signal, letting one weak signal set the whole score.)
   */
  private calculateCategoryScore(signals: DetectionSignal[]): number {
    if (signals.length === 0) return 0;
    let score = 0;
    let totalWeight = 0;
    for (const signal of signals) {
      score += signal.value * signal.confidence * signal.weight;
      totalWeight += signal.weight;
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
