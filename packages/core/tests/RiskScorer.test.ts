import { RiskScorer } from '../src/engine/RiskScorer';

describe('RiskScorer', () => {
  let scorer: RiskScorer;

  beforeEach(() => {
    scorer = new RiskScorer();
  });

  it('should return score of 0 for clean request', () => {
    const signals = [
      { category: 'ip', score: 0, weight: 1.0 },
      { category: 'ua', score: 0, weight: 1.0 }
    ];
    const result = scorer.calculate(signals);
    expect(result.totalScore).toBe(0);
  });

  it('should return score > 80 for bot-like signals', () => {
    const signals = [
      { category: 'ip', score: 90, weight: 1.0 },
      { category: 'behavior', score: 85, weight: 1.5 }
    ];
    const result = scorer.calculate(signals);
    expect(result.totalScore).toBeGreaterThan(80);
  });

  it('should handle weighted combination of signal categories', () => {
    const signals = [
      { category: 'network', score: 50, weight: 0.5 }, // contributes 25
      { category: 'browser', score: 100, weight: 2.0 } // contributes 200 (capped appropriately)
    ];
    const result = scorer.calculate(signals);
    // Exact calculation depends on formula, check relative scaling
    expect(result.totalScore).toBeGreaterThan(50);
  });

  it('should boost score for critical signals', () => {
    const normalSignals = [
      { category: 'ip', score: 20, weight: 1.0 }
    ];
    const normalScore = scorer.calculate(normalSignals).totalScore;

    const criticalSignals = [
      { category: 'ip', score: 20, weight: 1.0 },
      { category: 'threat_intel', score: 100, weight: 3.0, isCritical: true }
    ];
    const criticalScore = scorer.calculate(criticalSignals).totalScore;

    expect(criticalScore).toBeGreaterThan(normalScore + 50);
  });

  it('should clamp score between 0 and 100', () => {
    const highSignals = [
      { category: 'a', score: 100, weight: 5.0 },
      { category: 'b', score: 100, weight: 5.0 }
    ];
    const highResult = scorer.calculate(highSignals);
    expect(highResult.totalScore).toBe(100);

    const lowSignals = [
      { category: 'a', score: -50, weight: 1.0 }
    ];
    const lowResult = scorer.calculate(lowSignals);
    expect(lowResult.totalScore).toBe(0);
  });
});
