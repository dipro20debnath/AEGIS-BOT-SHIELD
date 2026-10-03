/**
 * Server-side session pattern analysis: looks at the *sequence* of requests in
 * one session (no client JavaScript needed), which catches HTTP-library bots
 * that never run the SDK.
 *
 * Signals (each needs a minimum number of requests to avoid judging short
 * human visits):
 * - timer_regular       page requests at near-constant intervals (cron/sleep loop)
 * - sequential_ids      /item/101, /item/102, /item/103 ... (catalogue scraping, OAT-011)
 * - crawl_breadth       many distinct pages, almost none revisited, at a fast pace
 * - error_probing       mostly 4xx responses (path/ID guessing, OAT-014/018)
 * - no_referer          navigations never carry a Referer
 * - no_assets           pages fetched without their CSS/JS/images (opt-in: wrong when assets come from a CDN)
 *
 * Limits: a bot that randomises timing, follows links like a person and loads
 * assets (a real browser) passes these checks; that is what the SDK's
 * behavioural layer is for.
 */
import { DetectionSignal } from '../../types/index.js';
import { BoundedMap } from '../../utils/bounded.js';

export type RequestKind = 'page' | 'asset' | 'api';

export interface SessionRequest {
  path: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  timestamp?: number;
}

interface RequestRecord {
  t: number;
  path: string;
  kind: RequestKind;
  hasReferer: boolean;
  status?: number;
}

export interface BotBehaviorOptions {
  /** Requests kept per session; default 100 */
  historySize?: number;
  /** Sessions tracked at once (oldest evicted); default 50,000 */
  maxSessions?: number;
  /** Flag sessions that load pages but no assets; default false */
  expectAssets?: boolean;
}

const ASSET_EXT = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|map|mp4|webm)$/i;
const ASSET_DEST = new Set(['script', 'style', 'image', 'font', 'audio', 'video', 'track', 'manifest', 'worker']);

function header(headers: SessionRequest['headers'], name: string): string | undefined {
  const v = headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

export function classifyRequest(req: SessionRequest): RequestKind {
  const dest = header(req.headers, 'sec-fetch-dest');
  if (dest === 'document' || dest === 'iframe') return 'page';
  if (dest && ASSET_DEST.has(dest)) return 'asset';
  const path = req.path.split('?')[0];
  if (ASSET_EXT.test(path)) return 'asset';
  const accept = header(req.headers, 'accept') ?? '';
  if (/text\/html/.test(accept)) return 'page';
  if (dest === 'empty' || /application\/json/.test(accept) || /^\/api\//.test(path)) return 'api';
  // Plain HTTP clients send Accept: */* for everything; treat GETs of non-asset paths as pages
  return (req.method ?? 'GET').toUpperCase() === 'GET' ? 'page' : 'api';
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** Length of the longest run of paths that differ only by a number increasing by a constant step. */
export function longestSequentialRun(paths: string[]): number {
  let best = 1;
  let run = 1;
  let prev: { template: string; id: number } | null = null;
  let step: number | null = null;
  for (const p of paths) {
    const m = p.split('?')[0].match(/^(.*?)(\d+)(\D*)$/);
    const cur = m ? { template: `${m[1]}#${m[3]}`, id: Number(m[2]) } : null;
    if (cur && prev && cur.template === prev.template && cur.id !== prev.id) {
      const d = cur.id - prev.id;
      if (step === null || d === step) {
        run = step === null ? 2 : run + 1;
        step = d;
      } else {
        run = 2;
        step = d;
      }
    } else {
      run = 1;
      step = null;
    }
    best = Math.max(best, run);
    prev = cur;
  }
  return best;
}

export class BotBehaviorAnalyzer {
  private sessions: BoundedMap<string, RequestRecord[]>;
  private historySize: number;
  private expectAssets: boolean;

  constructor(options: BotBehaviorOptions = {}) {
    this.historySize = options.historySize ?? 100;
    this.sessions = new BoundedMap(options.maxSessions ?? 50_000);
    this.expectAssets = options.expectAssets ?? false;
  }

  /** Record a request and return signals for the session so far. */
  public observe(sessionId: string, req: SessionRequest): DetectionSignal[] {
    const history = this.sessions.get(sessionId) ?? [];
    history.push({
      t: req.timestamp ?? Date.now(),
      path: req.path,
      kind: classifyRequest(req),
      hasReferer: Boolean(header(req.headers, 'referer')),
    });
    if (history.length > this.historySize) history.shift();
    this.sessions.set(sessionId, history);
    return this.analyze(sessionId);
  }

  /** Attach the response status to the session's latest request (call after the handler ran). */
  public recordResponse(sessionId: string, status: number): void {
    const history = this.sessions.get(sessionId);
    const last = history?.[history.length - 1];
    if (last && last.status === undefined) last.status = status;
  }

  public analyze(sessionId: string): DetectionSignal[] {
    const history = this.sessions.get(sessionId) ?? [];
    const pages = history.filter(r => r.kind === 'page');
    const signals: DetectionSignal[] = [];
    const add = (type: string, value: number, confidence: number, description: string) =>
      signals.push({ category: 'behavioral', type: `session.${type}`, value, confidence, description, weight: 1.1 });

    if (pages.length >= 8) {
      const gaps = pages.slice(1).map((r, i) => r.t - pages[i].t).slice(-20);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const cv = coefficientOfVariation(gaps);
      // People read pages for irregular lengths of time; human CV is typically > 0.5
      if (mean > 0 && mean < 60_000 && cv < 0.15) {
        add('timer_regular', 65, cv < 0.05 ? 0.85 : 0.7, `${gaps.length} page requests at near-constant ${Math.round(mean)} ms intervals (CV ${cv.toFixed(2)})`);
      }
    }

    const run = longestSequentialRun(pages.map(r => r.path));
    if (run >= 5) {
      add('sequential_ids', 70, Math.min(0.9, 0.5 + run * 0.05), `${run} consecutive pages with sequential numeric IDs`);
    }

    if (pages.length >= 30) {
      const span = pages[pages.length - 1].t - pages[0].t;
      const unique = new Set(pages.map(r => r.path.split('?')[0])).size;
      if (unique / pages.length > 0.9 && span < 5 * 60_000) {
        add('crawl_breadth', 50, 0.6, `${unique} distinct pages in ${Math.round(span / 1000)} s with almost no revisits`);
      }
    }

    const answered = history.filter(r => r.status !== undefined);
    if (answered.length >= 10) {
      const clientErrors = answered.filter(r => r.status! >= 400 && r.status! < 500).length;
      if (clientErrors / answered.length > 0.5) {
        add('error_probing', 60, 0.7, `${clientErrors}/${answered.length} requests ended in 4xx (path or ID guessing)`);
      }
    }

    // The first page of a visit has no referer when typed or bookmarked; later navigations normally do
    if (pages.length >= 5 && pages.slice(1).every(r => !r.hasReferer)) {
      add('no_referer', 40, 0.5, `${pages.length} page navigations without any Referer`);
    }

    if (this.expectAssets && pages.length >= 5 && !history.some(r => r.kind === 'asset')) {
      add('no_assets', 55, 0.6, `${pages.length} pages fetched without any CSS/JS/image request`);
    }
    return signals;
  }

  public forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  public get size(): number {
    return this.sessions.size;
  }
}
