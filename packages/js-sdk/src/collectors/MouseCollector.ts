/**
 * Mouse Movement Behavioral Collector
 *
 * Captures and analyzes mouse dynamics for bot detection.
 * Humans exhibit natural micro-tremors (8-12 Hz), curved paths,
 * variable velocity, and overshoot on target acquisition.
 * Bots show perfectly straight lines, constant velocity,
 * zero tremor, and pixel-perfect clicks.
 *
 * Collected metrics (thesis-critical for ML model):
 * - Velocity (px/ms): mean, std, max
 * - Acceleration (px/ms²): mean, std
 * - Jerk (px/ms³): rate of acceleration change
 * - Curvature: path deviation from straight line (0=straight, 1=curved)
 * - Straightness Index: direct_distance / path_length
 * - Click Precision: distance from element center at click time
 * - Micro-tremor Frequency: FFT analysis of tiny movements (Hz)
 * - Fitts' Law R²: correlation with Fitts' law predictions
 * - Direction Changes: count of velocity direction reversals
 * - Pause Distribution: time gaps between movement bursts
 *
 * Sampling: captures at requestAnimationFrame rate (~60Hz)
 * Memory-efficient: stores rolling window of last N samples
 */
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

export class MouseCollector {
  private samples: Array<{ x: number; y: number; t: number }> = [];
  private clicks: Array<{ x: number; y: number; t: number; targetRect?: DOMRect }> = [];
  private isCollecting = false;
  private maxSamples: number;
  private onMoveHandler: ((e: MouseEvent) => void) | null = null;
  private onClickHandler: ((e: MouseEvent) => void) | null = null;
  private rafId: number | null = null;
  private pendingEvents: MouseEvent[] = [];

  constructor(options?: { maxSamples?: number }) {
    this.maxSamples = options?.maxSamples || 2000;
  }

  public start(): void {
    if (this.isCollecting) return;
    this.isCollecting = true;
    this.onMoveHandler = (e: MouseEvent) => this.pendingEvents.push(e);
    this.onClickHandler = (e: MouseEvent) => this.recordClick(e);
    document.addEventListener('mousemove', this.onMoveHandler, { passive: true });
    document.addEventListener('click', this.onClickHandler, { passive: true });
    this.startRafLoop();
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onMoveHandler) document.removeEventListener('mousemove', this.onMoveHandler);
    if (this.onClickHandler) document.removeEventListener('click', this.onClickHandler);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private startRafLoop(): void {
    const loop = () => {
      if (!this.isCollecting) return;
      if (this.pendingEvents.length > 0) {
        for (const e of this.pendingEvents) {
          this.recordSample(e);
        }
        this.pendingEvents = [];
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private recordSample(e: MouseEvent): void {
    this.samples.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  private recordClick(e: MouseEvent): void {
    let targetRect: DOMRect | undefined;
    if (e.target && e.target instanceof Element) {
      targetRect = e.target.getBoundingClientRect();
    }
    this.clicks.push({ x: e.clientX, y: e.clientY, t: Date.now(), targetRect });
  }

  public getData(): MouseAnalysis {
    const eventCount = this.samples.length;
    if (eventCount < 2) {
      return this.emptyAnalysis();
    }

    const vels: number[] = [];
    const accels: number[] = [];
    const jerks: number[] = [];
    let pathLength = 0;
    let directionChanges = 0;
    let pauseCount = 0;
    let totalPauseDuration = 0;

    let prevVx = 0;
    let prevVy = 0;
    
    let totalAngleChange = 0;
    let angleChangeCount = 0;

    for (let i = 1; i < this.samples.length; i++) {
      const p1 = this.samples[i - 1];
      const p2 = this.samples[i];
      const dt = p2.t - p1.t;
      if (dt === 0) continue;

      if (dt > 50) {
        pauseCount++;
        totalPauseDuration += dt;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      pathLength += dist;

      const vx = dx / dt;
      const vy = dy / dt;
      const v = dist / dt;
      vels.push(v);

      if (i > 1) {
        const dv = v - vels[vels.length - 2];
        const a = dv / dt;
        accels.push(a);

        if (Math.sign(vx) !== Math.sign(prevVx) || Math.sign(vy) !== Math.sign(prevVy)) {
          directionChanges++;
        }

        const dotProduct = prevVx * vx + prevVy * vy;
        const mag1 = Math.sqrt(prevVx * prevVx + prevVy * prevVy);
        const mag2 = Math.sqrt(vx * vx + vy * vy);
        if (mag1 > 0 && mag2 > 0) {
          let cosTheta = dotProduct / (mag1 * mag2);
          cosTheta = Math.max(-1, Math.min(1, cosTheta));
          totalAngleChange += Math.acos(cosTheta);
          angleChangeCount++;
        }
      }

      if (i > 2 && accels.length > 1) {
        const da = accels[accels.length - 1] - accels[accels.length - 2];
        const j = da / dt;
        jerks.push(j);
      }

      prevVx = vx;
      prevVy = vy;
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const directDist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    const straightnessIndex = pathLength > 0 ? directDist / pathLength : 0;
    const curvatureScore = angleChangeCount > 0 ? totalAngleChange / angleChangeCount : 0;

    let clickPrecisionSum = 0;
    let fittsLawR2 = 0;

    if (this.clicks.length > 0) {
      let precisionCount = 0;
      const fittsX: number[] = [];
      const fittsY: number[] = [];

      for (const click of this.clicks) {
        if (click.targetRect) {
          const cx = click.targetRect.left + click.targetRect.width / 2;
          const cy = click.targetRect.top + click.targetRect.height / 2;
          const dist = Math.sqrt(Math.pow(click.x - cx, 2) + Math.pow(click.y - cy, 2));
          clickPrecisionSum += dist;
          precisionCount++;
          
          const D = Math.sqrt(Math.pow(first.x - cx, 2) + Math.pow(first.y - cy, 2));
          const W = Math.min(click.targetRect.width, click.targetRect.height);
          if (W > 0) {
            fittsX.push(Math.log2((D / W) + 1));
            fittsY.push(click.t - first.t);
          }
        }
      }
      
      const clickPrecision = precisionCount > 0 ? clickPrecisionSum / precisionCount : 0;

      if (fittsX.length > 1) {
        const meanX = fittsX.reduce((a, b) => a + b, 0) / fittsX.length;
        const meanY = fittsY.reduce((a, b) => a + b, 0) / fittsY.length;
        let num = 0, den1 = 0, den2 = 0;
        for (let i = 0; i < fittsX.length; i++) {
          const dx = fittsX[i] - meanX;
          const dy = fittsY[i] - meanY;
          num += dx * dy;
          den1 += dx * dx;
          den2 += dy * dy;
        }
        fittsLawR2 = (den1 > 0 && den2 > 0) ? Math.pow(num / Math.sqrt(den1 * den2), 2) : 0;
      }
    }

    const avgVelocity = this.avg(vels);
    const avgAcceleration = this.avg(accels);

    return {
      eventCount,
      avgVelocity,
      velocityStd: this.std(vels, avgVelocity),
      maxVelocity: vels.length > 0 ? Math.max(...vels) : 0,
      avgAcceleration,
      accelerationStd: this.std(accels, avgAcceleration),
      avgJerk: this.avg(jerks),
      straightnessIndex,
      curvatureScore,
      clickCount: this.clicks.length,
      clickPrecision: this.clicks.length > 0 ? clickPrecisionSum / this.clicks.length : 0,
      microTremorFreq: this.estimateMicroTremorFreq(),
      fittsLawR2,
      directionChanges,
      pauseCount,
      avgPauseDuration: pauseCount > 0 ? totalPauseDuration / pauseCount : 0,
      totalDuration: last.t - first.t,
      samples: this.samples.slice(-100).map(s => [s.x, s.y, s.t])
    };
  }

  private estimateMicroTremorFreq(): number {
    if (this.samples.length < 3) return 0;
    let zeroCrossings = 0;
    let prevDelta = 0;
    
    for (let i = 1; i < this.samples.length; i++) {
      const p1 = this.samples[i - 1];
      const p2 = this.samples[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const delta = dx + dy;
      
      if (Math.abs(delta) < 2) {
        if (Math.sign(delta) !== Math.sign(prevDelta) && prevDelta !== 0) {
          zeroCrossings++;
        }
        prevDelta = delta;
      }
    }
    
    const durationSec = (this.samples[this.samples.length - 1].t - this.samples[0].t) / 1000;
    return durationSec > 0 ? (zeroCrossings / 2) / durationSec : 0;
  }

  public reset(): void {
    this.samples = [];
    this.clicks = [];
    this.pendingEvents = [];
  }

  public getSampleCount(): number {
    return this.samples.length;
  }

  private avg(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  private std(arr: number[], mean: number): number {
    if (arr.length === 0) return 0;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
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
      clickPrecision: 0,
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
