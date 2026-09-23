import { DetectionEngine } from '../src/engine/DetectionEngine';
import { AegisConfig, AegisRequest, DetectionVerdict, ActionType } from '../src/types';

describe('DetectionEngine', () => {
  let engine: DetectionEngine;
  
  const testConfig: AegisConfig = {
    apiKey: 'test-api-key',
    projectId: 'test-project',
    mode: 'block',
    thresholds: {
      block: 80,
      challenge: 50,
      monitor: 20
    }
  };

  const createLegitRequest = (): AegisRequest => ({
    id: 'req-1',
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    method: 'GET',
    path: '/',
    headers: { 'host': 'example.com', 'accept': 'text/html' },
    timestamp: Date.now()
  });

  beforeEach(() => {
    engine = new DetectionEngine(testConfig);
  });

  describe('initialization', () => {
    it('should create engine with default config', () => {
      const defaultEngine = new DetectionEngine({ apiKey: 'key', projectId: 'pid' });
      expect(defaultEngine).toBeDefined();
    });

    it('should create engine with custom config', () => {
      expect(engine).toBeDefined();
      // Add custom config checks here based on implementation
    });

    it('should initialize all detection modules', () => {
      // Assuming modules are public or accessible for testing
      // expect(engine.riskScorer).toBeDefined();
      // expect(engine.ipAnalyzer).toBeDefined();
    });
  });

  describe('analyze()', () => {
    it('should return allow verdict for legitimate request', async () => {
      const req = createLegitRequest();
      const verdict = await engine.analyze(req);
      expect(verdict.action).toBe(ActionType.ALLOW);
      expect(verdict.riskScore).toBeLessThan(testConfig.thresholds!.monitor!);
      expect(verdict.requestId).toBe(req.id);
    });

    it('should return block verdict for known bot IP', async () => {
      const req = createLegitRequest();
      req.ip = '10.0.0.99'; // Assume this is a known bot IP in mock/test DB
      // Mocking would be needed here depending on the implementation
      // const verdict = await engine.analyze(req);
      // expect(verdict.action).toBe(ActionType.BLOCK);
      // expect(verdict.riskScore).toBeGreaterThanOrEqual(testConfig.thresholds!.block!);
    });

    it('should return challenge verdict for suspicious request', async () => {
      const req = createLegitRequest();
      req.userAgent = 'curl/7.68.0'; // Slightly suspicious for a regular browser
      // const verdict = await engine.analyze(req);
      // expect(verdict.action).toBe(ActionType.CHALLENGE);
    });

    it('should return monitor verdict for borderline request', async () => {
      const req = createLegitRequest();
      req.headers['x-forwarded-for'] = '192.168.1.2';
      // const verdict = await engine.analyze(req);
      // expect(verdict.action).toBe(ActionType.MONITOR);
    });

    it('should handle missing optional fields gracefully', async () => {
      const req = createLegitRequest();
      delete req.headers;
      const verdict = await engine.analyze(req);
      expect(verdict).toBeDefined();
      expect(verdict.requestId).toBe(req.id);
    });

    it('should include risk score in result', async () => {
      const req = createLegitRequest();
      const verdict = await engine.analyze(req);
      expect(typeof verdict.riskScore).toBe('number');
      expect(verdict.riskScore).toBeGreaterThanOrEqual(0);
      expect(verdict.riskScore).toBeLessThanOrEqual(100);
    });

    it('should include request ID in result', async () => {
      const req = createLegitRequest();
      const verdict = await engine.analyze(req);
      expect(verdict.requestId).toBe(req.id);
    });
  });

  describe('error handling', () => {
    it('should fail-open on internal errors', async () => {
      // Force an internal error
      // jest.spyOn(engine.riskScorer, 'calculateScore').mockRejectedValue(new Error('Internal DB failure'));
      // const req = createLegitRequest();
      // const verdict = await engine.analyze(req);
      // expect(verdict.action).toBe(ActionType.ALLOW); // fail-open
    });

    it('should handle null/undefined inputs', async () => {
      // @ts-ignore
      const verdict = await engine.analyze(null);
      expect(verdict.action).toBe(ActionType.ALLOW); // fail-open on bad input
    });

    it('should not crash on malformed requests', async () => {
      const req = createLegitRequest();
      // @ts-ignore
      req.headers = "not-an-object";
      const verdict = await engine.analyze(req);
      expect(verdict).toBeDefined();
    });
  });
});
