/**
 * Mouse Movement Behavioral Collector
 *
 * Captures and analyzes mouse dynamics for bot detection.
 * Humans exhibit natural micro-tremors (8-12 Hz), curved paths,
 * variable velocity, and overshoot on target acquisition.
 * Bots show perfectly straight lines, constant velocity,
 * zero tremor, and pixel-perfect clicks.
 *
 * Collected metrics (units match the ML feature contract,
 * docs/thesis/irb/data_dictionary.md):
 * - Velocity (px/s): mean, std, max
 * - Acceleration (px/s²): mean, std
 * - Jerk (px/s³): mean absolute rate of acceleration change
 * - Straightness Index (0-1): mean over strokes of direct distance / path length
 * - Curvature Score (0-1): mean turning angle between segments / π
 * - Click Precision (0-1): 1 = click at the target's centre, 0 = at its corner or outside
 * - Micro-tremor Frequency (Hz): zero-crossing estimate on small movements
 * - Fitts' Law R²: fit of movement time against log2(D/W + 1) over clicks
 * - Direction Changes, Pause Count / Duration (ms)
 *
 * A stroke is a run of movement without a pause longer than PAUSE_MS.
 * Timestamps come from the event (high resolution), not from when it is processed.
 * Memory-efficient: stores rolling window of last N samples
 */
import { mean, std } from './stats';

export interface MouseAnalysis {
  eventCount: number;
  avgVelocity: number;
  velocityStd: number;
  maxVelocity: number;
  avgAcceleration: number;
  accelerationStd: number;
  avgJerk: number;
  straightnessIndex: number;
  curvatureScore: number;
  clickCount: number;
  clickPrecision: number;
  microTremorFreq: number;
  fittsLawR2: number;
  directionChanges: number;
  pauseCount: number;
  avgPauseDuration: number;
  totalDuration: number;
  samples: Array<[number, number, number]>;
}

interface Sample { x: number; y: number; t: number }
interface Click { precision: number; fittsIndex: number; movementTime: number }

/** Gap (ms) that ends a stroke and counts as a pause */
const PAUSE_MS = 100;

export class MouseCollector {
  private samples: Sample[] = [];
  private clicks: Click[] = [];
  private strokeStart: Sample | null = null;
  private isCollecting = false;
  private maxSamples: number;
  private onMoveHandler: ((e: MouseEvent) => void) | null = null;
  private onClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(options?: { maxSamples?: number }) {
    this.maxSamples = options?.maxSamples || 2000;
  }

  public start(): void {
    if (this.isCollecting) return;
    this.isCollecting = true;
    this.onMoveHandler = (e: MouseEvent) => this.addSample(e.clientX, e.clientY, e.timeStamp);
    this.onClickHandler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.getBoundingClientRect() : undefined;
      this.addClick(e.clientX, e.clientY, e.timeStamp, target);
    };
    document.addEventListener('mousemove', this.onMoveHandler, { passive: true });
    document.addEventListener('click', this.onClickHandler, { passive: true });
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onMoveHandler) document.removeEventListener('mousemove', this.onMoveHandler);
    if (this.onClickHandler) document.removeEventListener('click', this.onClickHandler);
  }

  /** Record one pointer position (t in ms). Public so traces can be replayed and tested. */
  public addSample(x: number, y: number, t: number): void {
    const prev = this.samples[this.samples.length - 1];
    if (prev && t <= prev.t) return; // duplicate or out-of-order event
    if (!prev || t - prev.t > PAUSE_MS) {
      this.strokeStart = { x, y, t };
    }
    this.samples.push({ x, y, t });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Record a click on a target with bounding box `rect` (t in ms). */
  public addClick(x: number, y: number, t: number, rect?: { left: number; top: number; width: number; height: number }): void {
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const halfDiagonal = Math.hypot(rect.width, rect.height) / 2;
    const precision = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / halfDiagonal);

    const start = this.strokeStart ?? { x, y, t };
    const distance = Math.hypot(cx - start.x, cy - start.y);
    const width = Math.min(rect.width, rect.height);
    this.clicks.push({
      precision,
      fittsIndex: Math.log2(distance / width + 1),
      movementTime: t - start.t,
    });
    if (this.clicks.length > 200) this.clicks.shift();
  }

  public getData(): MouseAnalysis {
    const eventCount = this.samples.length;
    if (eventCount < 2) {
      return this.emptyAnalysis();
    }

    const vels: number[] = [];
    const accels: number[] = [];
    const jerks: number[] = [];
    const turnAngles: number[] = [];
    const strokeStraightness: number[] = [];
    let directionChanges = 0;
    let pauseCount = 0;
    let totalPauseDuration = 0;

    let prev: { vx: number; vy: number; v: number; a: number | null } | null = null;
    let strokeFirst = this.samples[0];
    let strokePath = 0;
    let strokePoints = 1;

    const endStroke = (last: Sample) => {
      if (strokePoints >= 3 && strokePath > 0) {
        strokeStraightness.push(Math.hypot(last.x - strokeFirst.x, last.y - strokeFirst.y) / strokePath);
      }
    };

    for (let i = 1; i < this.samples.length; i++) {
      const p1 = this.samples[i - 1];
      const p2 = this.samples[i];
      const dtMs = p2.t - p1.t;

      if (dtMs > PAUSE_MS) {
        pauseCount++;
        totalPauseDuration += dtMs;
        endStroke(p1);
        strokeFirst = p2;
        strokePath = 0;
        strokePoints = 1;
        prev = null;
        continue;
      }

      const dt = dtMs / 1000;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      strokePath += dist;
      strokePoints++;

      const vx = dx / dt;
      const vy = dy / dt;
      const v = dist / dt;
      vels.push(v);

      let a: number | null = null;
      if (prev) {
        a = (v - prev.v) / dt;
        accels.push(a);
        if (prev.a !== null) jerks.push(Math.abs((a - prev.a) / dt));

        if ((vx !== 0 && prev.vx !== 0 && Math.sign(vx) !== Math.sign(prev.vx))
            || (vy !== 0 && prev.vy !== 0 && Math.sign(vy) !== Math.sign(prev.vy))) {
          directionChanges++;
        }
        const mag = v * prev.v;
        if (mag > 0) {
          const cos = Math.max(-1, Math.min(1, (prev.vx * vx + prev.vy * vy) / mag));
          turnAngles.push(Math.acos(cos));
        }
      }
      prev = { vx, vy, v, a };
    }
    endStroke(this.samples[this.samples.length - 1]);

    const avgVelocity = mean(vels);
    const avgAcceleration = mean(accels);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    return {
      eventCount,
      avgVelocity,
      velocityStd: std(vels, avgVelocity),
      maxVelocity: vels.length > 0 ? Math.max(...vels) : 0,
      avgAcceleration,
      accelerationStd: std(accels, avgAcceleration),
      avgJerk: mean(jerks),
      straightnessIndex: mean(strokeStraightness),
      curvatureScore: mean(turnAngles) / Math.PI,
      clickCount: this.clicks.length,
      clickPrecision: mean(this.clicks.map(c => c.precision)),
      microTremorFreq: this.estimateMicroTremorFreq(),
      fittsLawR2: this.fittsR2(),
      directionChanges,
      pauseCount,
      avgPauseDuration: pauseCount > 0 ? totalPauseDuration / pauseCount : 0,
      totalDuration: last.t - first.t,
      samples: this.samples.slice(-100).map(s => [s.x, s.y, s.t])
    };
  }

  /** R² of movement time regressed on the Fitts index of difficulty. */
  private fittsR2(): number {
    const pts = this.clicks.filter(c => c.movementTime > 0);
    if (pts.length < 3) return 0;
    const xs = pts.map(c => c.fittsIndex);
    const ys = pts.map(c => c.movementTime);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < pts.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx2 += (xs[i] - mx) ** 2;
      dy2 += (ys[i] - my) ** 2;
    }
    return dx2 > 0 && dy2 > 0 ? (num * num) / (dx2 * dy2) : 0;
  }

  /**
   * Estimate tremor frequency from sign changes of small displacements.
   * A heuristic: real tremor analysis needs a steady >= 25 Hz sampling rate.
   */
  private estimateMicroTremorFreq(): number {
    if (this.samples.length < 3) return 0;
    let zeroCrossings = 0;
    let prevDelta = 0;

    for (let i = 1; i < this.samples.length; i++) {
      const p1 = this.samples[i - 1];
      const p2 = this.samples[i];
      const delta = (p2.x - p1.x) + (p2.y - p1.y);
      if (Math.abs(delta) < 2) {
        if (Math.sign(delta) !== Math.sign(prevDelta) && prevDelta !== 0 && delta !== 0) {
          zeroCrossings++;
        }
        if (delta !== 0) prevDelta = delta;
      }
    }

    const durationSec = (this.samples[this.samples.length - 1].t - this.samples[0].t) / 1000;
    return durationSec > 0 ? (zeroCrossings / 2) / durationSec : 0;
  }

  public reset(): void {
    this.samples = [];
    this.clicks = [];
    this.strokeStart = null;
  }

  public getSampleCount(): number {
    return this.samples.length;
  }

  private emptyAnalysis(): MouseAnalysis {
    return {
      eventCount: this.samples.length,
      avgVelocity: 0,
      velocityStd: 0,
      maxVelocity: 0,
      avgAcceleration: 0,
      accelerationStd: 0,
      avgJerk: 0,
      straightnessIndex: 0,
      curvatureScore: 0,
      clickCount: this.clicks.length,
      clickPrecision: mean(this.clicks.map(c => c.precision)),
      microTremorFreq: 0,
      fittsLawR2: 0,
      directionChanges: 0,
      pauseCount: 0,
      avgPauseDuration: 0,
      totalDuration: 0,
      samples: []
    };
  }
}
