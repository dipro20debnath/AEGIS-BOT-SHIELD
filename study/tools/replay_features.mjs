/**
 * Recompute behavioural features from an exported dataset's raw events, with
 * the SDK's own collector code (packages/js-sdk/src/replay.ts).
 *
 *   node study/tools/replay_features.mjs dataset/ [--out replayed.csv] [--at 5,10,30]
 *
 * One row per page view (features over the whole view), plus, with --at, one
 * row per page view and cut-off time in seconds (features as they were at that
 * moment: for "how early can a bot be detected" analyses).
 */
import { build } from 'esbuild';
import { createReadStream, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dataset = args.find(a => !a.startsWith('--'));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!dataset || !existsSync(join(dataset, 'raw'))) {
  console.error('usage: node study/tools/replay_features.mjs <dataset dir with raw/> [--out file.csv] [--at 5,10,30]');
  process.exit(2);
}
const cutoffs = (opt('--at') || '').split(',').filter(Boolean).map(Number);
const out = opt('--out') || join(dataset, 'replayed_features.csv');

// Bundle the SDK replay module (TypeScript) for Node
const bundle = join(mkdtempSync(join(tmpdir(), 'aegis-replay-')), 'replay.mjs');
await build({ entryPoints: [join(here, '..', '..', 'packages', 'js-sdk', 'src', 'replay.ts')], bundle: true,
  format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' });
const { replayFeatures } = await import(pathToFileURL(bundle).href);

const contract = JSON.parse(readFileSync(join(here, '..', '..', 'contracts', 'features.json'), 'utf8'));
const names = ['mouse', 'keyboard', 'scroll', 'touch'].flatMap(c => contract.categories[c].features.map(f => f[0]));
const rows = [['session_id', 'page_view', 'page', 'task', 'cutoff_s', 'n_events', 'duration_ms', ...names].join(',')];

for (const file of readdirSync(join(dataset, 'raw')).filter(f => f.endsWith('.jsonl.gz')).sort()) {
  const sessionId = file.replace('.jsonl.gz', '');
  const views = new Map();
  const lines = createInterface({ input: createReadStream(join(dataset, 'raw', file)).pipe(createGunzip()) });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const batch = JSON.parse(line);
    const view = views.get(batch.page_view) ?? { page: batch.page, task: batch.task, batches: [] };
    view.batches.push(batch);
    views.set(batch.page_view, view);
  }
  for (const [pageView, view] of views) {
    const events = view.batches.sort((a, b) => a.seq - b.seq).flatMap(b => b.events);
    const duration = events.length ? events[events.length - 1][1] - events[0][1] : 0;
    for (const cutoff of [null, ...cutoffs]) {
      const start = events.length ? events[0][1] : 0;
      const until = cutoff === null ? undefined : start + cutoff * 1000;
      if (cutoff !== null && cutoff * 1000 > duration) continue;
      const f = replayFeatures(events, { until });
      const flat = { ...f.mouse, ...f.keyboard, ...f.scroll, ...f.touch };
      const used = until === undefined ? events.length : events.filter(e => e[1] <= until).length;
      rows.push([sessionId, pageView, view.page ?? '', view.task ?? '', cutoff ?? '', used, Math.round(duration),
        ...names.map(n => flat[n] ?? '')].join(','));
    }
  }
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(`${rows.length - 1} rows -> ${out}`);
