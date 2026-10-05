/**
 * Recompute the behavioural features from a raw event stream recorded by the
 * study site (study/aegis_study/static/recorder.js), with the same collector
 * code the SDK runs in the browser. Used to re-extract features offline (for
 * any time window) and to check that the live telemetry matches the raw data.
 *
 * Differences from live collection, by design of the recorder:
 * - pointer moves are pointer events including coalesced samples, so mouse
 *   features can be computed at a higher sampling rate than the live SDK's
 *   mousemove listener sees;
 * - touch radius is derived from the pointer contact size; the number of
 *   simultaneous touches is not recorded (counted as 1).
 * Keyboard and scroll features are computed from the same event timestamps
 * as live and should match the live values.
 */
import { MouseCollector } from './collectors/MouseCollector';
import { KeyboardCollector } from './collectors/KeyboardCollector';
import { ScrollCollector } from './collectors/ScrollCollector';
import { TouchCollector } from './collectors/TouchCollector';
import { buildTelemetry, TelemetryPayload } from './telemetry';

/** [type, t (ms since the page's timeOrigin), ...fields]; see recorder.js for the types */
export type RawEvent = [string, number, ...unknown[]];

export interface ReplayOptions {
  /** Only events with t <= until (ms): features as they were at that moment */
  until?: number;
  /** Mouse samples kept, as in the live collector (default 2000) */
  maxSamples?: number;
}

export type BehaviourFeatures = Pick<TelemetryPayload['features'], 'mouse' | 'keyboard' | 'scroll' | 'touch'>;

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function replayFeatures(events: RawEvent[], options: ReplayOptions = {}): BehaviourFeatures {
  const mouse = new MouseCollector({ maxSamples: options.maxSamples });
  const keyboard = new KeyboardCollector();
  const scroll = new ScrollCollector();
  const touch = new TouchCollector();
  let pageHeight = 0;
  let viewportHeight = 0;
  const until = options.until ?? Infinity;

  for (const e of events) {
    const [type, t] = e;
    if (t > until) continue;
    switch (type) {
      case 'n': pageHeight = num(e[3]); break;
      case 'r': viewportHeight = num(e[3]); break;
      case 'm':
        if (num(e[4]) === 0) mouse.addSample(num(e[2]), num(e[3]), t);
        else if (num(e[4]) === 2) touch.addTouch(touchPoint(e, 'move'));
        break;
      case 'd': if (num(e[4]) === 2) touch.addTouch(touchPoint(e, 'start')); break;
      case 'u': if (num(e[4]) === 2) touch.addTouch(touchPoint(e, 'end')); break;
      case 'c':
        if (e.length >= 9) {
          mouse.addClick(num(e[2]), num(e[3]), t, { left: num(e[5]), top: num(e[6]), width: num(e[7]), height: num(e[8]) });
        }
        break;
      case 'k':
        if (!e[5]) keyboard.keyDown(String(e[3]), e[2] === 'b' || e[2] === 'd', t);
        break;
      case 'K':
        if (e[3] !== null && e[3] !== undefined) keyboard.keyUp(String(e[3]), t);
        break;
      case 'p': keyboard.paste(); break;
      case 's': scroll.addPosition(num(e[3]), Math.max(0, pageHeight - viewportHeight), t); break;
      default: break;
    }
  }

  const { features } = buildTelemetry({
    mouse: mouse.getData(),
    keyboard: keyboard.getData(),
    scroll: scroll.getData(),
    touch: touch.getData(),
    device: { hasWebGL: false, hasCanvas: false, pluginCount: 0 }, // fingerprint features are not replayed
  }, { siteKey: 'replay', streamId: 'replay', now: 0 });
  return { mouse: features.mouse, keyboard: features.keyboard, scroll: features.scroll, touch: features.touch };
}

type TouchPoint = { x: number; y: number; t: number; type: string; pressure: number; radius: number; touches: number };

function touchPoint(e: RawEvent, type: string): TouchPoint {
  // move rows carry [.., pressure, width, height]; down/up rows do not
  const width = type === 'move' ? num(e[6]) : 0;
  const height = type === 'move' ? num(e[7]) : 0;
  return {
    x: num(e[2]), y: num(e[3]), t: e[1], type,
    pressure: type === 'move' ? num(e[5]) : 0,
    radius: (width + height) / 4,
    touches: 1,
  };
}
