import { RiskScorer } from '../src/engine/RiskScorer';
import { DetectionSignal } from '../src/types';

const sig = (overrides: Partial<DetectionSignal>): DetectionSignal => ({
  category: 'network', type: 'test.signal', value: 50, confidence: 1, description: 'test', weight: 1,
  ...overrides,
});

describe('RiskScorer', () => {
  const scorer = new RiskScorer();

  it('returns zero for no signals', () => {
    const score = scorer.calculateCompositeScore([]);
    expect(score.score).toBe(0);
    expect(score.confidence).toBe(0);
  });

  it('scores a single category by its signal values', () => {
    const score = scorer.calculateCompositeScore([sig({ value: 40 })]);
    expect(score.score).toBe(40);
    expect(score.categories.network).toBe(40);
    expect(score.factors['test.signal']).toBe(40);
  });

  it('weights signals within a category by weight x confidence', () => {
    const score = scorer.calculateCompositeScore([
      sig({ type: 'a', value: 100, weight: 3, confidence: 1 }),
      sig({ type: 'b', value: 0, weight: 1, confidence: 1 }),
    ]);
    expect(score.categories.network).toBeCloseTo(75);
  });

  it('discounts a lone low-confidence signal', () => {
    const score = scorer.calculateCompositeScore([sig({ value: 80, confidence: 0.5 })]);
    expect(score.score).toBe(40);
  });

  it('combines independent categories with noisy-OR', () => {
    const score = scorer.calculateCompositeScore([
      sig({ type: 'a', category: 'network', value: 50 }),
      sig({ type: 'b', category: 'protocol', value: 50 }),
    ]);
    expect(score.score).toBe(75);
  });

  it('never lowers the score when weak evidence from another layer is added', () => {
    const strong = [sig({ type: 'honeypot', category: 'behavioral', value: 98 })];
    const withWeak = [...strong, sig({ type: 'weak', category: 'protocol', value: 30, confidence: 0.4 })];
    expect(scorer.calculateCompositeScore(withWeak).score)
      .toBeGreaterThanOrEqual(scorer.calculateCompositeScore(strong).score);
  });

  it('applies category multipliers', () => {
    const halfProtocol = new RiskScorer({ protocol: 0.5 });
    expect(halfProtocol.calculateCompositeScore([sig({ category: 'protocol', value: 60 })]).score).toBe(30);
  });

  it('raises the score to at least 85 for a headless signal', () => {
    const score = scorer.calculateCompositeScore([sig({ type: 'behavior.headless_browser', category: 'device', value: 60 })]);
    expect(score.score).toBeGreaterThanOrEqual(85);
  });

  it('clamps the score to 0-100', () => {
    const score = scorer.calculateCompositeScore([
      sig({ type: 'a', value: 100 }), sig({ type: 'b', value: 100, category: 'device' }),
      sig({ type: 'c', value: 100, category: 'behavioral' }),
    ]);
    expect(score.score).toBe(100);
  });
});
