import { describe, expect, it } from 'vitest';
import { KeyboardCollector } from '../src/collectors/KeyboardCollector';
import { replayFeatures, RawEvent } from '../src/replay';

describe('replayFeatures (study raw events -> SDK features)', () => {
  const keys: RawEvent[] = [
    ['k', 100, 'c', 1, 'username', 0], ['K', 180, 'c', 1],
    ['k', 260, 'c', 2, 'username', 0], ['k', 300, 'c', 3, 'username', 0], // rollover
    ['K', 330, 'c', 2], ['K', 390, 'c', 3],
    ['k', 395, 'c', 3, 'username', 1],                                     // auto-repeat: ignored
    ['k', 500, 'b', 4, 'username', 0], ['K', 560, 'b', 4],
    ['p', 600, 'username'],
  ];

  it('gives the same keyboard features as the live collector fed the same timings', () => {
    const live = new KeyboardCollector();
    live.keyDown('KeyA', false, 100); live.keyUp('KeyA', 180);
    live.keyDown('KeyB', false, 260); live.keyDown('KeyC', false, 300);
    live.keyUp('KeyB', 330); live.keyUp('KeyC', 390);
    live.keyDown('Backspace', true, 500); live.keyUp('Backspace', 560);
    live.paste();
    const replayed = replayFeatures(keys).keyboard;
    const d = live.getData();
    expect(replayed.kb_avg_dwell_time).toBeCloseTo(d.avgDwellTime, 6);
    expect(replayed.kb_avg_flight_time).toBeCloseTo(d.avgFlightTime, 6);
    expect(replayed.kb_correction_ratio).toBeCloseTo(d.correctionRatio, 6);
    expect(replayed.kb_paste_count).toBe(1);
  });

  it('replays mouse moves, clicks and scrolling, and honours `until`', () => {
    const events: RawEvent[] = [['r', 0, 1200, 800, 1, 1920, 1080], ['n', 1, 1200, 2400]];
    for (let i = 0; i < 60; i++) events.push(['m', 10 + i * 16, 100 + i * 5 + Math.sin(i) * 2, 200 + i * 2, 0]);
    events.push(['c', 1000, 410, 320, 'button:add', 380, 300, 60, 40]); // at the target's centre
    for (let i = 0; i < 20; i++) events.push(['s', 1100 + i * 30, 0, i * 40]);
    const all = replayFeatures(events);
    expect(all.mouse.mouse_event_count).toBe(60);
    expect(all.mouse.mouse_click_precision).toBeGreaterThan(0.9);
    expect(all.scroll.scroll_event_count).toBe(20);
    expect(all.scroll.scroll_max_depth).toBeCloseTo(760 / 1600, 6);
    expect(replayFeatures(events, { until: 500 }).mouse.mouse_event_count).toBe(31);
  });

  it('turns touch pointer events into touch features', () => {
    const events: RawEvent[] = [['d', 0, 10, 10, 2, 0, 'button'], ['m', 16, 12, 30, 2, 0.5, 20, 20],
      ['m', 32, 14, 60, 2, 0.5, 20, 20], ['u', 48, 14, 60, 2, 0]];
    const t = replayFeatures(events).touch;
    expect(t.touch_avg_radius).toBeCloseTo(10, 6);
    expect(t.touch_avg_pressure).toBeGreaterThan(0);
  });
});
