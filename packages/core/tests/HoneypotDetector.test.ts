import { HoneypotDetector } from '../src/modules/honeypot/HoneypotDetector';

describe('HoneypotDetector', () => {
  const detector = new HoneypotDetector({ customTrapEndpoints: ['/secret-trap'] });

  it('flags requests to trap endpoints, including custom ones', () => {
    expect(detector.checkRequest('/wp-admin', 'GET').signals[0].type).toBe('honeypot.trap_endpoint');
    expect(detector.checkRequest('/secret-trap', 'GET').triggered).toBe(true);
    expect(detector.checkRequest('/products', 'GET').triggered).toBe(false);
  });

  it('flags filled hidden form fields', () => {
    const { signals } = detector.checkRequest('/contact', 'POST', { name: 'A', website_url: 'http://spam' });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: 'honeypot.form_filled', value: 100, category: 'behavioral' });
  });

  it('flags impossibly fast and suspiciously fast form submissions', () => {
    expect(detector.checkFormSubmission({}, 50)[0].type).toBe('honeypot.timing_fast');
    expect(detector.checkFormSubmission({}, 500)[0].type).toBe('honeypot.timing_suspicious');
    expect(detector.checkFormSubmission({ name: 'A' }, 5000)).toEqual([]);
  });

  it('generates hidden fields and LLM canary traps', () => {
    expect(detector.generateHiddenFields().length).toBeGreaterThan(0);
    const html = detector.generateLlmTrap('page-1');
    const canary = html.match(/aegis-canary-[0-9a-f]+/)![0];
    expect(detector.checkLlmCanary(`summary ... ${canary}`, 'page-1')).toBe(true);
    expect(detector.checkLlmCanary('a normal response', 'page-1')).toBe(false);
  });
});
