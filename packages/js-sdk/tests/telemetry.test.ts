import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTelemetry } from '../src/telemetry';
import { MouseCollector } from '../src/collectors/MouseCollector';
import { KeyboardCollector } from '../src/collectors/KeyboardCollector';

const contract = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/features.json'), 'utf8'));

describe('telemetry payload', () => {
  const payload = buildTelemetry({ device: { hasWebGL: true, hasCanvas: true, pluginCount: 5, fingerprintHash: 'abc' } },
    { siteKey: 'site', streamId: 'stream', now: 1 });

  it('uses exactly the SDK feature keys of contracts/features.json, in order', () => {
    for (const [category, spec] of Object.entries<any>(contract.categories)) {
      if (spec.source !== 'sdk') continue;
      const expected = spec.features.map((f: string[]) => f[0]);
      expect(Object.keys((payload.features as any)[category])).toEqual(expected);
    }
  });

  it('does not send server-side categories', () => {
    expect(Object.keys(payload.features).sort()).toEqual(['fingerprint', 'keyboard', 'mouse', 'scroll', 'touch']);
  });

  it('converts units and keeps every value finite', () => {
    const k = new KeyboardCollector();
    k.keyDown('a', false, 0); k.keyUp('a', 80); k.keyDown('b', false, 1500); k.keyUp('b', 1580);
    const m = new MouseCollector();
    m.addSample(0, 0, 0); m.addSample(10, 0, 10);
    const p = buildTelemetry({ keyboard: k.getData(), mouse: m.getData(), device: { hasWebGL: false, hasCanvas: true, pluginCount: 0 } },
      { siteKey: 's', streamId: 'x' });
    expect(p.features.keyboard.kb_total_duration).toBeCloseTo(1.5); // seconds
    expect(p.features.mouse.mouse_avg_velocity).toBeCloseTo(1000); // px/s
    expect(p.features.fingerprint).toEqual({ has_webgl: 0, has_canvas: 1, plugin_count: 0, is_headless: 0, headless_confidence: 0 });
    for (const group of Object.values(p.features)) {
      for (const v of Object.values(group)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('carries only a fingerprint hash, not raw device data', () => {
    expect(payload.behavioral.fingerprint).toBe('abc');
    expect(JSON.stringify(payload)).not.toMatch(/userAgent|Mozilla/);
  });
});
