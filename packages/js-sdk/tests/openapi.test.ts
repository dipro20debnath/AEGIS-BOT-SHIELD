import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { buildTelemetry } from '../src/telemetry';
import { MouseCollector } from '../src/collectors/MouseCollector';
import { KeyboardCollector } from '../src/collectors/KeyboardCollector';

const spec = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/openapi.json'), 'utf8'));

describe('telemetry payload vs contracts/openapi.json', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema({ $id: 'openapi.json', components: spec.components });
  const validate = ajv.compile({ $ref: 'openapi.json#/components/schemas/TelemetryPayload' });

  it('matches the TelemetryPayload schema with and without behaviour data', () => {
    const empty = buildTelemetry({ device: { hasWebGL: true, hasCanvas: true, pluginCount: 3 } }, { siteKey: 's', streamId: 'x', now: 1 });
    expect(validate(empty), ajv.errorsText(validate.errors)).toBe(true);

    const k = new KeyboardCollector();
    k.keyDown('a', false, 0); k.keyUp('a', 80); k.keyDown('b', false, 300); k.keyUp('b', 390);
    const m = new MouseCollector();
    for (let i = 0; i < 20; i++) m.addSample(i * 7, i * 3, i * 16);
    const full = buildTelemetry({ keyboard: k.getData(), mouse: m.getData(), device: { hasWebGL: false, hasCanvas: true, pluginCount: 0, fingerprintHash: 'ab' },
      headless: { isHeadless: false, confidence: 0, checks: [] } as never }, { siteKey: 's', streamId: 'y', now: 2 });
    expect(validate(full), ajv.errorsText(validate.errors)).toBe(true);
  });
});
