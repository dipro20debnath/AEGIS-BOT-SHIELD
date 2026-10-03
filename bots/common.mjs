// Shared helpers for the JavaScript bots.
export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const CHROMIUM = process.env.CHROME_BINARY ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function parseArgs() {
  const get = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  return { target: get('target', 'http://localhost:8000').replace(/\/$/, ''), runs: Number(get('runs', 1)), mode: get('mode', 'default') };
}

export function credentials(target) {
  return target.endsWith(':3000') ? ['admin', 'password'] : ['demo', 'demo'];
}

export function emit(bot, target, run, result) {
  console.log(JSON.stringify({ bot, target, run, time: Date.now() / 1000, ...result, passed: result.login_status === 200 }));
}

/** Records the page's telemetry and login responses. */
export function recorder(page, onResponse) {
  const log = { telemetry: [], login: null, page_status: null, pow_solved: 0, login_attempts: 0 };
  onResponse(async (url, status, json) => {
    if (url.endsWith('/aegis/telemetry')) log.telemetry.push({ status, score: json?.score, verdict: json?.verdict });
    else if (url.endsWith('/aegis/challenge') && json?.token) log.pow_solved++;
    else if (url.endsWith('/api/login')) { log.login_attempts++; log.login = { status, body: json }; }
  });
  return log;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const rand = (a, b) => a + Math.random() * (b - a);

/** Points of a cubic Bezier from (x0,y0) to (x1,y1) with random control points and jitter. */
export function humanPath(x0, y0, x1, y1, steps = Math.round(rand(25, 45))) {
  const c1 = [x0 + (x1 - x0) * rand(0.2, 0.4) + rand(-80, 80), y0 + (y1 - y0) * rand(0.1, 0.3) + rand(-80, 80)];
  const c2 = [x0 + (x1 - x0) * rand(0.6, 0.8) + rand(-60, 60), y0 + (y1 - y0) * rand(0.7, 0.9) + rand(-60, 60)];
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    // ease-in-out timing like a minimum-jerk reach
    const s = i / steps, t = s * s * (3 - 2 * s);
    const x = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * c1[0] + 3 * (1 - t) * t ** 2 * c2[0] + t ** 3 * x1;
    const y = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c1[1] + 3 * (1 - t) * t ** 2 * c2[1] + t ** 3 * y1;
    pts.push([x + rand(-1.2, 1.2), y + rand(-1.2, 1.2)]);
  }
  return pts;
}

/** After submitting: wait until the login answer is final (the SDK may solve a challenge and retry). */
export async function settle(log, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const l = log.login;
    if (l && !(l.status === 403 && l.body?.aegis === 'challenge' && log.pow_solved < 1)) {
      await sleep(500);
      if (log.login === l) return;
    }
    await sleep(100);
  }
}
