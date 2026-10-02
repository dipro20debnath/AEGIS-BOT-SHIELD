import { DetectionEngine, analyzeBehavior, SESSION_HEADER } from '../src/engine/DetectionEngine';
import { AegisRequest, AegisEvent, BehavioralPayload, ThreatCategory } from '../src/types';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let counter = 0;
const browserRequest = (overrides: Partial<AegisRequest> = {}): AegisRequest => ({
  ip: '103.230.104.10',
  method: 'GET',
  path: '/products',
  headers: {
    'user-agent': CHROME_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,bn;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    referer: 'https://shop.example/',
    connection: 'keep-alive',
    host: 'shop.example',
  },
  timestamp: Date.now(),
  requestId: `req-${++counter}`,
  ...overrides,
});

const humanBehavior = (): BehavioralPayload => ({
  timestamp: Date.now(),
  mouse: { eventCount: 150, avgVelocity: 0.4, velocityStd: 0.2, avgAcceleration: 1, avgJerk: 5,
    straightnessIndex: 0.75, clickCount: 4, clickPrecision: 0.7, microTremorFreq: 10, fittsLawR2: 0.85, samples: [] },
  keyboard: { eventCount: 40, avgDwellTime: 110, dwellTimeStd: 30, avgFlightTime: 180, flightTimeStd: 60,
    typingSpeed: 250, pasteCount: 0, correctionRatio: 0.05, cadenceEntropy: 4 },
});

describe('DetectionEngine', () => {
  const engines: DetectionEngine[] = [];
  const make = async (config: ConstructorParameters<typeof DetectionEngine>[0] = {}) => {
    const engine = new DetectionEngine({ mode: 'enforce', ...config });
    await engine.init();
    engines.push(engine);
    return engine;
  };
  afterAll(async () => { await Promise.all(engines.map(e => e.shutdown())); });

  it('fails open when not initialised', async () => {
    const engine = new DetectionEngine();
    const result = await engine.analyze(browserRequest());
    expect(result.verdict).toBe('allow');
    expect(result.reason).toMatch(/Fail-open/);
    await engine.shutdown();
  });

  it('allows an ordinary browser request with human behaviour', async () => {
    const engine = await make();
    const result = await engine.analyze(browserRequest({ behavioralData: humanBehavior() }));
    expect(result.verdict).toBe('allow');
    expect(result.riskScore.score).toBeLessThan(50);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('blocks a request that fills a honeypot field', async () => {
    const engine = await make();
    const result = await engine.analyze(browserRequest({
      method: 'POST', path: '/contact', body: { name: 'x', website_url: 'http://spam.example' },
    }));
    expect(result.verdict).toBe('block');
    expect(result.threats).toContain(ThreatCategory.OAT_017_SPAMMING);
    expect(result.reason).toContain('Honeypot form field filled');
  });

  it('blocks a headless browser reported by the SDK', async () => {
    const engine = await make();
    const result = await engine.analyze(browserRequest({
      behavioralData: { ...humanBehavior(), isHeadless: true },
    }));
    expect(result.riskScore.score).toBeGreaterThanOrEqual(85);
    expect(result.verdict).toBe('block');
  });

  it('scores a scripted client higher than a browser', async () => {
    const engine = await make();
    const browser = await engine.analyze(browserRequest());
    const script = await engine.analyze(browserRequest({ headers: { 'user-agent': 'python-requests/2.31.0', accept: '*/*' } }));
    expect(script.riskScore.score).toBeGreaterThan(browser.riskScore.score);
    expect(script.signals.map(s => s.type)).toContain('threat.pattern');
  });

  it('blocks once the per-IP rate limit is exceeded (enforce mode)', async () => {
    const engine = await make({ rateLimiting: { perIpCapacity: 2, perIpRefillRate: 0.001 } as any });
    await engine.analyze(browserRequest({ ip: '103.230.104.60' }));
    await engine.analyze(browserRequest({ ip: '103.230.104.60' }));
    const third = await engine.analyze(browserRequest({ ip: '103.230.104.60' }));
    expect(third.verdict).toBe('block');
    expect(third.threats).toContain(ThreatCategory.OAT_015_DENIAL_OF_SERVICE);
  });

  it('applies per-endpoint limits and maps login abuse to credential stuffing', async () => {
    const engine = await make({ rateLimiting: { endpointLimits: { '/login': { maxRequests: 1, windowMs: 60_000 } } } as any });
    await engine.analyze(browserRequest({ ip: '103.230.104.61', method: 'POST', path: '/login' }));
    const second = await engine.analyze(browserRequest({ ip: '103.230.104.61', method: 'POST', path: '/login' }));
    expect(second.verdict).toBe('block');
    expect(second.threats).toContain(ThreatCategory.OAT_008_CREDENTIAL_STUFFING);
  });

  it('never blocks in monitor mode', async () => {
    const engine = await make({ mode: 'monitor' });
    const result = await engine.analyze(browserRequest({ behavioralData: { ...humanBehavior(), isHeadless: true } }));
    expect(result.verdict).toBe('monitor');
  });

  it('issues a session token and resumes the session', async () => {
    const engine = await make({ secretKey: 'engine-secret' });
    const first = await engine.analyze(browserRequest({ ip: '103.230.104.70' }));
    expect(first.sessionToken).toMatch(/^[0-9a-f-]+\.[0-9a-f]+$/);
    const second = await engine.analyze(browserRequest({
      ip: '103.230.104.71', headers: { ...browserRequest().headers, [SESSION_HEADER]: first.sessionToken! },
    }));
    expect(second.signals.map(s => s.type)).toContain('session.ip_changed');
  });

  it('emits analysis and block events', async () => {
    const engine = await make();
    const events: AegisEvent[] = [];
    engine.on('request.analyzed', e => events.push(e));
    engine.on('request.blocked', e => events.push(e));
    await engine.analyze(browserRequest({ method: 'POST', path: '/contact', body: { website_url: 'x' } }));
    expect(events.map(e => e.type)).toEqual(['request.analyzed', 'request.blocked']);
  });

  it('respects disabled modules', async () => {
    const engine = await make({ modules: { honeypot: false } as any });
    const result = await engine.analyze(browserRequest({ method: 'POST', path: '/contact', body: { website_url: 'x' } }));
    expect(result.signals.some(s => s.type.startsWith('honeypot'))).toBe(false);
  });
});

describe('analyzeBehavior', () => {
  it('returns no signals for human-like behaviour', () => {
    expect(analyzeBehavior(humanBehavior())).toEqual([]);
  });

  it('flags mechanical mouse and typing patterns', () => {
    const data = humanBehavior();
    data.mouse!.straightnessIndex = 0.995;
    data.mouse!.microTremorFreq = 0;
    data.keyboard!.avgDwellTime = 5;
    data.keyboard!.cadenceEntropy = 0.2;
    const types = analyzeBehavior(data).map(s => s.type);
    expect(types).toEqual(expect.arrayContaining([
      'behavior.mouse_linear', 'behavior.mouse_no_tremor', 'behavior.key_dwell_too_short', 'behavior.typing_uniform',
    ]));
  });

  it('flags a session with no interaction at all', () => {
    expect(analyzeBehavior({ timestamp: Date.now() }).map(s => s.type)).toEqual(['behavior.no_interaction']);
  });
});
