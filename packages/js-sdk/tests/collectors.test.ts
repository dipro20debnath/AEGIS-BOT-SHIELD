import { describe, expect, it } from 'vitest';
import { MouseCollector } from '../src/collectors/MouseCollector';
import { KeyboardCollector } from '../src/collectors/KeyboardCollector';
import { ScrollCollector } from '../src/collectors/ScrollCollector';
import { TouchCollector } from '../src/collectors/TouchCollector';

describe('MouseCollector', () => {
  it('reports velocity in px/s and straightness 1 for a straight constant-speed line', () => {
    const m = new MouseCollector();
    for (let i = 0; i <= 20; i++) m.addSample(i * 10, 0, i * 10); // 10 px every 10 ms
    const d = m.getData();
    expect(d.avgVelocity).toBeCloseTo(1000);
    expect(d.velocityStd).toBeCloseTo(0);
    expect(d.straightnessIndex).toBeCloseTo(1);
    expect(d.curvatureScore).toBeCloseTo(0);
    expect(d.avgAcceleration).toBeCloseTo(0);
  });

  it('measures straightness per stroke, split at pauses', () => {
    const m = new MouseCollector();
    for (let i = 0; i <= 10; i++) m.addSample(i * 10, 0, i * 10);            // stroke 1 →
    for (let i = 0; i <= 10; i++) m.addSample(100 - i * 10, 50, 1000 + i * 10); // stroke 2 ← after a pause
    const d = m.getData();
    expect(d.pauseCount).toBe(1);
    expect(d.avgPauseDuration).toBe(900);
    expect(d.straightnessIndex).toBeCloseTo(1); // each stroke is straight even though the session is not
  });

  it('gives a zig-zag path lower straightness and higher curvature', () => {
    const m = new MouseCollector();
    for (let i = 0; i <= 20; i++) m.addSample(i * 10, i % 2 === 0 ? 0 : 10, i * 10);
    const d = m.getData();
    expect(d.straightnessIndex).toBeLessThan(0.8);
    expect(d.curvatureScore).toBeGreaterThan(0.3);
    expect(d.directionChanges).toBeGreaterThan(10);
  });

  it('scores click precision 1 at the centre and 0 at the corner', () => {
    const rect = { left: 0, top: 0, width: 100, height: 40 };
    const centre = new MouseCollector();
    centre.addClick(50, 20, 100, rect);
    expect(centre.getData().clickPrecision).toBeCloseTo(1);
    const corner = new MouseCollector();
    corner.addClick(0, 0, 100, rect);
    expect(corner.getData().clickPrecision).toBeCloseTo(0);
  });

  it("computes Fitts' law R² = 1 when movement time is linear in the index of difficulty", () => {
    const m = new MouseCollector();
    let t = 0;
    for (const distance of [50, 150, 350, 750]) {
      t += 1000;                         // pause -> new stroke starts here
      const id = Math.log2(distance / 20 + 1);
      const mt = 100 + 150 * id;
      const steps = Math.ceil(mt / 10);  // pointer events every <= 10 ms along the path
      for (let s = 0; s < steps; s++) m.addSample((distance * s) / steps, 0, t + (mt * s) / steps);
      m.addClick(distance, 0, t + mt, { left: distance - 10, top: -10, width: 20, height: 20 });
    }
    expect(m.getData().fittsLawR2).toBeCloseTo(1, 5);
  });

  it('ignores duplicate and out-of-order timestamps', () => {
    const m = new MouseCollector();
    m.addSample(0, 0, 10);
    m.addSample(5, 0, 10);
    m.addSample(5, 0, 5);
    expect(m.getSampleCount()).toBe(1);
  });
});

describe('KeyboardCollector', () => {
  it('pairs each keyup with its own keydown under rollover', () => {
    const k = new KeyboardCollector();
    k.keyDown('KeyA', false, 0);
    k.keyDown('KeyB', false, 50);   // B pressed before A is released
    k.keyUp('KeyA', 100);
    k.keyUp('KeyB', 160);
    k.keyDown('KeyC', false, 200);
    k.keyUp('KeyC', 290);
    const d = k.getData();
    expect(d.avgDwellTime).toBeCloseTo((100 + 110 + 90) / 3);
    expect(d.avgFlightTime).toBeCloseTo(40); // C down 200 - B up 160
    expect(d.eventCount).toBe(6);
  });

  it('computes WPM, correction ratio and ignores auto-repeat', () => {
    const k = new KeyboardCollector();
    for (let i = 0; i < 11; i++) {
      const id = i === 5 ? 'Backspace' : `Key${i}`;
      k.keyDown(id, i === 5, i * 200);
      k.keyDown(id, i === 5, i * 200 + 30); // auto-repeat while held
      k.keyUp(id, i * 200 + 80);
    }
    const d = k.getData();
    // 10 intervals of 200 ms = 300 keys/min = 60 WPM
    expect(d.typingSpeed).toBeCloseTo(60);
    expect(d.correctionRatio).toBeCloseTo(1 / 11);
    expect(d.totalDuration).toBe(2000);
  });

  it('never exposes key identities', () => {
    const k = new KeyboardCollector();
    k.keyDown('KeyS', false, 0);
    k.keyUp('KeyS', 90);
    expect(JSON.stringify(k.getData())).not.toContain('Key');
  });
});

describe('ScrollCollector', () => {
  it('reports depth as a fraction and speed in px/s', () => {
    const s = new ScrollCollector();
    s.addPosition(0, 2000, 0);
    s.addPosition(500, 2000, 100);
    s.addPosition(1000, 2000, 200);
    const d = s.getData();
    expect(d.maxScrollDepth).toBeCloseTo(0.5);
    expect(d.avgScrollSpeed).toBeCloseTo(5000);
  });

  it('detects inertial (decaying) scroll runs', () => {
    const s = new ScrollCollector();
    let y = 0;
    s.addPosition(y, 5000, 0);
    [400, 300, 200, 120, 60, 20].forEach((dy, i) => { y += dy; s.addPosition(y, 5000, (i + 1) * 16); });
    expect(s.getData().momentumScrolls).toBeGreaterThanOrEqual(3);

    const programmatic = new ScrollCollector();
    programmatic.addPosition(0, 5000, 0);
    programmatic.addPosition(3000, 5000, 16);
    expect(programmatic.getData().momentumScrolls).toBe(0);
  });
});

describe('TouchCollector', () => {
  it('averages radiusX and radiusY and reports swipe speed in px/s', () => {
    const t = new TouchCollector();
    t.addTouch({ x: 0, y: 0, t: 0, type: 'start', pressure: 0.5, radius: (10 + 20) / 2, touches: 1 });
    t.addTouch({ x: 300, y: 0, t: 200, type: 'end', pressure: 0.5, radius: 15, touches: 0 });
    const d = t.getData();
    expect(d.avgRadius).toBe(15);
    expect(d.swipeCount).toBe(1);
    expect(d.avgSwipeVelocity).toBeCloseTo(1500);
  });
});
