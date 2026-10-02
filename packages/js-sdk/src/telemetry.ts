/**
 * Builds the telemetry payload the SDK sends to the AEGIS server.
 *
 * `features` follows contracts/features.json exactly (snake_case keys and
 * units shared with the ML extractor). Session and network features are
 * added server-side. `behavioral` is the compact camelCase summary the
 * rule-based core engine reads (BehavioralPayload in @aegis/core).
 *
 * Privacy: no key content, text, URLs or raw user agent leave the browser;
 * the device fingerprint is sent only as a SHA-256 hash.
 */
import type { MouseAnalysis } from './collectors/MouseCollector';
import type { KeyboardAnalysis } from './collectors/KeyboardCollector';
import type { ScrollAnalysis } from './collectors/ScrollCollector';
import type { TouchAnalysis } from './collectors/TouchCollector';
import type { HeadlessDetectionResult } from './types';
import type { AntiDetectResult } from './detection/AntiDetectDetector';

export const TELEMETRY_VERSION = 1;

export interface DeviceSignals {
  hasWebGL: boolean;
  hasCanvas: boolean;
  pluginCount: number;
  /** SHA-256 of the device fingerprint components */
  fingerprintHash?: string;
}

export interface TelemetryInput {
  mouse?: MouseAnalysis;
  keyboard?: KeyboardAnalysis;
  scroll?: ScrollAnalysis;
  touch?: TouchAnalysis;
  headless?: HeadlessDetectionResult | null;
  antiDetect?: AntiDetectResult | null;
  device: DeviceSignals;
}

export type FeatureGroup = Record<string, number>;

export interface TelemetryPayload {
  v: number;
  siteKey: string;
  /** Random id for this page view's telemetry stream (not a user id) */
  streamId: string;
  timestamp: number;
  features: {
    mouse: FeatureGroup;
    keyboard: FeatureGroup;
    scroll: FeatureGroup;
    touch: FeatureGroup;
    fingerprint: FeatureGroup;
  };
  behavioral: {
    mouse?: { eventCount: number; avgVelocity: number; velocityStd: number; avgAcceleration: number; avgJerk: number;
      straightnessIndex: number; clickCount: number; clickPrecision: number; microTremorFreq: number;
      fittsLawR2: number; samples: Array<[number, number, number]> };
    keyboard?: { eventCount: number; avgDwellTime: number; dwellTimeStd: number; avgFlightTime: number;
      flightTimeStd: number; typingSpeed: number; pasteCount: number; correctionRatio: number; cadenceEntropy: number };
    scroll?: { eventCount: number; avgVelocity: number; directionChanges: number; maxDepth: number; hasMomentum: boolean;
      scrollTypes: { wheel: number; touch: number; programmatic: number } };
    touch?: { eventCount: number; avgPressure: number; avgRadius: number; multiTouchCount: number; swipeVelocity: number;
      tapPrecision: number };
    fingerprint?: string;
    isHeadless: boolean;
    timestamp: number;
  };
  /** Names of headless checks that fired, for diagnostics */
  headlessChecks: string[];
  /** Anti-detect browser consistency checks (outside the 50-feature ML contract) */
  antiDetect?: { score: number; checks: string[] };
}

const ratio = (part: number, total: number): number => (total > 0 ? part / total : 0);
const flag = (value: boolean): number => (value ? 1 : 0);

export function mouseFeatures(m?: MouseAnalysis): FeatureGroup {
  return {
    mouse_avg_velocity: m?.avgVelocity ?? 0,
    mouse_velocity_std: m?.velocityStd ?? 0,
    mouse_max_velocity: m?.maxVelocity ?? 0,
    mouse_avg_acceleration: m?.avgAcceleration ?? 0,
    mouse_acceleration_std: m?.accelerationStd ?? 0,
    mouse_avg_jerk: m?.avgJerk ?? 0,
    mouse_straightness_index: m?.straightnessIndex ?? 0,
    mouse_curvature_score: m?.curvatureScore ?? 0,
    mouse_click_precision: m?.clickPrecision ?? 0,
    mouse_micro_tremor_freq: m?.microTremorFreq ?? 0,
    mouse_fitts_law_r2: m?.fittsLawR2 ?? 0,
    mouse_direction_changes: m?.directionChanges ?? 0,
    mouse_pause_count: m?.pauseCount ?? 0,
    mouse_avg_pause_duration: m?.avgPauseDuration ?? 0,
    mouse_event_count: m?.eventCount ?? 0,
  };
}

export function keyboardFeatures(k?: KeyboardAnalysis): FeatureGroup {
  return {
    kb_avg_dwell_time: k?.avgDwellTime ?? 0,
    kb_dwell_time_std: k?.dwellTimeStd ?? 0,
    kb_avg_flight_time: k?.avgFlightTime ?? 0,
    kb_flight_time_std: k?.flightTimeStd ?? 0,
    kb_typing_speed: k?.typingSpeed ?? 0,
    kb_paste_count: k?.pasteCount ?? 0,
    kb_correction_ratio: k?.correctionRatio ?? 0,
    kb_cadence_entropy: k?.cadenceEntropy ?? 0,
    kb_total_events: k?.eventCount ?? 0,
    kb_total_duration: (k?.totalDuration ?? 0) / 1000,
  };
}

export function scrollFeatures(s?: ScrollAnalysis): FeatureGroup {
  return {
    scroll_avg_velocity: s?.avgScrollSpeed ?? 0,
    scroll_direction_changes: s?.directionChanges ?? 0,
    scroll_max_depth: s?.maxScrollDepth ?? 0,
    scroll_event_count: s?.eventCount ?? 0,
    scroll_momentum_ratio: ratio(s?.momentumScrolls ?? 0, s?.eventCount ?? 0),
  };
}

export function touchFeatures(t?: TouchAnalysis): FeatureGroup {
  return {
    touch_avg_pressure: t?.avgPressure ?? 0,
    touch_avg_radius: t?.avgRadius ?? 0,
    touch_swipe_velocity: t?.avgSwipeVelocity ?? 0,
    touch_tap_count: t?.tapCount ?? 0,
    touch_multi_touch_ratio: ratio(t?.multiTouchCount ?? 0, t?.eventCount ?? 0),
  };
}

export function fingerprintFeatures(device: DeviceSignals, headless?: HeadlessDetectionResult | null): FeatureGroup {
  return {
    has_webgl: flag(device.hasWebGL),
    has_canvas: flag(device.hasCanvas),
    plugin_count: device.pluginCount,
    is_headless: flag(headless?.isHeadless ?? false),
    headless_confidence: headless?.confidence ?? 0,
  };
}

/** Replaces NaN/Infinity (e.g. from a zero time delta) so the JSON stays valid. */
function finite(group: FeatureGroup): FeatureGroup {
  const out: FeatureGroup = {};
  for (const [key, value] of Object.entries(group)) {
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

export function buildTelemetry(input: TelemetryInput, meta: { siteKey: string; streamId: string; now?: number }): TelemetryPayload {
  const { mouse, keyboard, scroll, touch, headless, antiDetect, device } = input;
  const timestamp = meta.now ?? Date.now();
  return {
    v: TELEMETRY_VERSION,
    siteKey: meta.siteKey,
    streamId: meta.streamId,
    timestamp,
    features: {
      mouse: finite(mouseFeatures(mouse)),
      keyboard: finite(keyboardFeatures(keyboard)),
      scroll: finite(scrollFeatures(scroll)),
      touch: finite(touchFeatures(touch)),
      fingerprint: finite(fingerprintFeatures(device, headless)),
    },
    behavioral: {
      mouse: mouse && {
        eventCount: mouse.eventCount, avgVelocity: mouse.avgVelocity, velocityStd: mouse.velocityStd,
        avgAcceleration: mouse.avgAcceleration, avgJerk: mouse.avgJerk, straightnessIndex: mouse.straightnessIndex,
        clickCount: mouse.clickCount, clickPrecision: mouse.clickPrecision, microTremorFreq: mouse.microTremorFreq,
        fittsLawR2: mouse.fittsLawR2, samples: [],
      },
      keyboard: keyboard && {
        eventCount: keyboard.eventCount, avgDwellTime: keyboard.avgDwellTime, dwellTimeStd: keyboard.dwellTimeStd,
        avgFlightTime: keyboard.avgFlightTime, flightTimeStd: keyboard.flightTimeStd, typingSpeed: keyboard.typingSpeed,
        pasteCount: keyboard.pasteCount, correctionRatio: keyboard.correctionRatio, cadenceEntropy: keyboard.cadenceEntropy,
      },
      scroll: scroll && {
        eventCount: scroll.eventCount, avgVelocity: scroll.avgScrollSpeed, directionChanges: scroll.directionChanges,
        maxDepth: scroll.maxScrollDepth, hasMomentum: scroll.momentumScrolls > 0,
        scrollTypes: { wheel: 0, touch: 0, programmatic: 0 },
      },
      touch: touch && {
        eventCount: touch.eventCount, avgPressure: touch.avgPressure, avgRadius: touch.avgRadius,
        multiTouchCount: touch.multiTouchCount, swipeVelocity: touch.avgSwipeVelocity, tapPrecision: 0,
      },
      fingerprint: device.fingerprintHash,
      isHeadless: headless?.isHeadless ?? false,
      timestamp,
    },
    headlessChecks: (headless?.tests ?? []).filter(t => t.detected).map(t => t.name),
    ...(antiDetect ? { antiDetect: { score: antiDetect.score, checks: antiDetect.checks.filter(c => c.detected).map(c => c.name) } } : {}),
  };
}
