export const SITE_KEY = 'site-test';
export const SECRET = 'test-secret-key-0123456789abcdef';
export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const BROWSER_HEADERS = {
  'user-agent': CHROME_UA,
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120"',
};

export function telemetry(human = true, siteKey = SITE_KEY) {
  return {
    v: 1, siteKey, streamId: 'stream-1', timestamp: Date.now(),
    features: {
      mouse: human ? { mouse_avg_velocity: 420, mouse_event_count: 210, mouse_straightness_index: 0.78, mouse_micro_tremor_freq: 9.5 } : { mouse_event_count: 0 },
      keyboard: human ? { kb_avg_dwell_time: 105, kb_total_events: 60, kb_cadence_entropy: 4.1 } : { kb_avg_dwell_time: 2, kb_total_events: 40 },
      scroll: {}, touch: {},
      fingerprint: { has_webgl: 1, has_canvas: 1, plugin_count: 5, is_headless: human ? 0 : 1, headless_confidence: human ? 0 : 0.8 },
    },
    behavioral: human
      ? { isHeadless: false, mouse: { eventCount: 210, avgVelocity: 420, velocityStd: 180, avgAcceleration: 30, avgJerk: 2e4,
          straightnessIndex: 0.78, clickCount: 4, clickPrecision: 0.7, microTremorFreq: 9.5, fittsLawR2: 0.8, samples: [] },
          keyboard: { eventCount: 60, avgDwellTime: 105, dwellTimeStd: 30, avgFlightTime: 170, flightTimeStd: 80,
            typingSpeed: 48, pasteCount: 0, correctionRatio: 0.06, cadenceEntropy: 4.1 } }
      : { isHeadless: true },
    headlessChecks: human ? [] : ['webdriver'],
  };
}
