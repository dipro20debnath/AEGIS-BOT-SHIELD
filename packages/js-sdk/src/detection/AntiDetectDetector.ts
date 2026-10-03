/**
 * Heuristics for anti-detect / fingerprint-spoofing browsers (Multilogin,
 * GoLogin, Dolphin{anty}, AdsPower, ...) and JavaScript stealth patches.
 *
 * Such tools replace individual fingerprint values (user agent, platform,
 * WebGL renderer, timezone, screen) per profile. Each value is plausible on
 * its own; the evidence is in *combinations* a real device cannot produce,
 * e.g. a Windows user agent with an Apple GPU, or a timezone whose offset
 * disagrees with Date. All checks are passive.
 *
 * Limits (state them in the thesis): a well-maintained anti-detect profile
 * that keeps every value consistent, and patches at the C++ level rather than
 * in JavaScript, passes these checks. A hit is evidence, not proof: odd but
 * real setups exist (e.g. remote desktops). The result is reported to the
 * server as a separate signal and does not change the 50-feature ML contract.
 */
import type { WebGPUFingerprint } from '../fingerprint/WebGPUFingerprinter';

export type OsFamily = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'chromeos' | 'unknown';

export interface BrowserEnvironment {
  userAgent: string;
  platform: string;
  uaData?: { platform?: string; mobile?: boolean; brands?: Array<{ brand: string; version: string }> };
  language?: string;
  languages?: readonly string[];
  webglVendor?: string;
  webglRenderer?: string;
  webgpu?: WebGPUFingerprint;
  timeZone?: string;
  /** new Date().getTimezoneOffset() */
  dateOffsetMinutes?: number;
  /** Offset of `timeZone` now, computed through Intl (minutes, same sign convention as Date) */
  intlOffsetMinutes?: number;
  screen?: { width: number; height: number; availWidth: number; availHeight: number };
  outerWidth?: number;
  outerHeight?: number;
  /** navigator properties whose value was redefined by script */
  overriddenProperties?: string[];
}

export interface AntiDetectCheck {
  name: string;
  detected: boolean;
  /** Strength of the evidence when detected, 0-1 */
  weight: number;
  details: string;
}

export interface AntiDetectResult {
  /** Noisy-OR of the detected checks' weights, 0-1 */
  score: number;
  suspected: boolean;
  checks: AntiDetectCheck[];
}

export function osFromUserAgent(ua: string): OsFamily {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Windows NT/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

export function osFromPlatform(platform: string): OsFamily {
  const p = platform.toLowerCase();
  if (p.startsWith('win')) return 'windows';
  if (p.startsWith('mac')) return 'mac';
  if (/iphone|ipad|ipod/.test(p)) return 'ios';
  if (p.includes('android')) return 'android';
  if (p.includes('cros')) return 'chromeos';
  if (p.includes('linux')) return 'linux';
  return 'unknown';
}

function osFromClientHints(platform: string): OsFamily {
  const p = platform.toLowerCase();
  if (p === 'windows') return 'windows';
  if (p === 'macos') return 'mac';
  if (p === 'android') return 'android';
  if (p === 'ios') return 'ios';
  if (p === 'chrome os' || p === 'chromeos') return 'chromeos';
  if (p === 'linux') return 'linux';
  return 'unknown';
}

/** Android reports a Linux navigator.platform, iPadOS a Mac one, ChromeOS a Linux one. */
function compatible(a: OsFamily, b: OsFamily): boolean {
  if (a === 'unknown' || b === 'unknown' || a === b) return true;
  const pair = [a, b].sort().join('+');
  return ['android+linux', 'ios+mac', 'chromeos+linux'].includes(pair);
}

export function gpuVendorFamily(text: string): string {
  const t = text.toLowerCase();
  if (/nvidia|geforce|quadro|rtx/.test(t)) return 'nvidia';
  if (/\bamd\b|radeon|\bati\b/.test(t)) return 'amd';
  if (/intel/.test(t)) return 'intel';
  if (/apple/.test(t)) return 'apple';
  if (/qualcomm|adreno/.test(t)) return 'qualcomm';
  if (/\barm\b|mali/.test(t)) return 'arm';
  return '';
}

function chromeMajor(ua: string): string | undefined {
  return ua.match(/Chrom(?:e|ium)\/(\d+)/)?.[1];
}

export function evaluateAntiDetect(env: BrowserEnvironment): AntiDetectResult {
  const checks: AntiDetectCheck[] = [];
  const add = (name: string, detected: boolean, weight: number, details: string) =>
    checks.push({ name, detected, weight, details: detected ? details : '' });
  const uaOs = osFromUserAgent(env.userAgent);
  const renderer = `${env.webglVendor ?? ''} ${env.webglRenderer ?? ''}`;

  // 1. User agent vs navigator.platform
  const platformOs = osFromPlatform(env.platform);
  add('uaPlatformMismatch', !compatible(uaOs, platformOs), 0.9,
    `user agent says ${uaOs}, navigator.platform "${env.platform}"`);

  // 2. User agent vs User-Agent Client Hints (Chromium only)
  if (env.uaData) {
    const hintsOs = osFromClientHints(env.uaData.platform ?? '');
    const uaMajor = chromeMajor(env.userAgent);
    const hintMajor = env.uaData.brands?.find(b => /Chrom/i.test(b.brand))?.version;
    const mobileUa = /Mobile|Android/i.test(env.userAgent);
    const reasons = [
      !compatible(uaOs, hintsOs) && `platform hint "${env.uaData.platform}"`,
      uaMajor && hintMajor && uaMajor !== hintMajor.split('.')[0] && `version ${uaMajor} vs hint ${hintMajor}`,
      env.uaData.mobile !== undefined && uaOs !== 'unknown' && env.uaData.mobile !== mobileUa && `mobile hint ${env.uaData.mobile}`,
    ].filter(Boolean);
    add('clientHintsMismatch', reasons.length > 0, 0.9, reasons.join('; '));
  }

  // 3. GPU that cannot exist on the claimed OS
  const r = renderer.toLowerCase();
  const gpuImpossible =
    (/apple (m\d|gpu)|apple\b.*metal|metal renderer/.test(r) && ['windows', 'android', 'linux'].includes(uaOs)) ||
    (/direct3d|d3d11|d3d9/.test(r) && ['mac', 'ios', 'android', 'linux'].includes(uaOs)) ||
    (/adreno|mali/.test(r) && ['windows', 'mac'].includes(uaOs) && !/arm|qualcomm|snapdragon/.test(r + env.platform.toLowerCase()));
  add('gpuOsMismatch', Boolean(env.webglRenderer) && gpuImpossible, 0.8, `WebGL renderer "${env.webglRenderer}" on ${uaOs}`);

  // 4. WebGL (spoofed by most tools) vs WebGPU adapter (often not)
  if (env.webgpu?.supported && env.webgpu.vendor && env.webglRenderer) {
    const a = gpuVendorFamily(renderer);
    const b = gpuVendorFamily(env.webgpu.vendor);
    // Laptops with integrated + discrete GPUs can legitimately report Intel/AMD vs NVIDIA/AMD
    const hybrid = ['intel+nvidia', 'amd+intel', 'amd+nvidia'].includes([a, b].sort().join('+'));
    add('webglWebgpuMismatch', Boolean(a && b && a !== b && !hybrid), 0.7, `WebGL ${a}, WebGPU ${b}`);
  }

  // 5. Timezone spoofed in one API but not the other
  if (env.dateOffsetMinutes !== undefined && env.intlOffsetMinutes !== undefined) {
    add('timezoneMismatch', env.dateOffsetMinutes !== env.intlOffsetMinutes, 0.8,
      `${env.timeZone} offset ${env.intlOffsetMinutes} min vs Date ${env.dateOffsetMinutes} min`);
  }

  // 6. Window larger than the screen it is on / available area larger than the screen
  if (env.screen) {
    const s = env.screen;
    const bad = s.availWidth > s.width || s.availHeight > s.height
      || (env.outerWidth ?? 0) > s.width + 32 || (env.outerHeight ?? 0) > s.height + 32;
    add('screenInconsistent', bad, 0.5,
      `screen ${s.width}x${s.height}, avail ${s.availWidth}x${s.availHeight}, window ${env.outerWidth}x${env.outerHeight}`);
  }

  // 7. navigator.language always equals languages[0] in real browsers
  if (env.language && env.languages?.length) {
    add('languageMismatch', env.language !== env.languages[0], 0.6, `language ${env.language}, languages[0] ${env.languages[0]}`);
  }

  // 8. Properties redefined by script (stealth plugins, JS-level spoofers)
  const overridden = env.overriddenProperties ?? [];
  add('nativeOverride', overridden.length > 0, 0.9, `redefined: ${overridden.join(', ')}`);

  const score = 1 - checks.filter(c => c.detected).reduce((benign, c) => benign * (1 - c.weight), 1);
  return { score: Math.round(score * 1000) / 1000, suspected: score >= 0.7, checks };
}

const WATCHED_PROPERTIES = ['userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency',
  'deviceMemory', 'webdriver', 'plugins', 'vendor', 'maxTouchPoints'];

/** navigator properties that are own (instance) properties or have a non-native getter. */
export function findOverriddenProperties(nav: Navigator = navigator): string[] {
  const out: string[] = [];
  const proto = Object.getPrototypeOf(nav);
  for (const prop of WATCHED_PROPERTIES) {
    try {
      if (Object.prototype.hasOwnProperty.call(nav, prop)) { out.push(prop); continue; }
      const getter = Object.getOwnPropertyDescriptor(proto, prop)?.get;
      if (getter && !/\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(getter))) out.push(prop);
    } catch {
      // Reading a hardened property threw: treat as untouched
    }
  }
  return out;
}

/** Offset in minutes (Date convention: UTC - local) of `timeZone` at `now`, via Intl. */
export function intlOffsetMinutes(timeZone: string, now = new Date()): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((now.getTime() - now.getMilliseconds() - asUtc) / 60_000);
  } catch {
    return undefined;
  }
}

function readWebGL(): { vendor?: string; renderer?: string } {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? ''),
      renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''),
    };
  } catch {
    return {};
  }
}

/** Snapshot of the current browser for evaluateAntiDetect(). */
export function readBrowserEnvironment(webgpu?: WebGPUFingerprint): BrowserEnvironment {
  const nav = navigator as Navigator & { userAgentData?: BrowserEnvironment['uaData'] };
  const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
  const now = new Date();
  const webgl = readWebGL();
  return {
    userAgent: nav.userAgent,
    platform: nav.platform ?? '',
    uaData: nav.userAgentData ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile, brands: nav.userAgentData.brands } : undefined,
    language: nav.language,
    languages: nav.languages,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    webgpu,
    timeZone,
    dateOffsetMinutes: now.getTimezoneOffset(),
    intlOffsetMinutes: timeZone ? intlOffsetMinutes(timeZone, now) : undefined,
    screen: typeof screen !== 'undefined'
      ? { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight }
      : undefined,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    overriddenProperties: findOverriddenProperties(nav),
  };
}

export class AntiDetectDetector {
  public detect(webgpu?: WebGPUFingerprint): AntiDetectResult {
    return evaluateAntiDetect(readBrowserEnvironment(webgpu));
  }
}
