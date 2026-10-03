#!/usr/bin/env node
/**
 * Phase D load tests: throughput and latency of the AEGIS servers.
 *
 *   npm run build
 *   pip install -e packages/ml-engine[server] -e "packages/server-python[redis]" uvicorn
 *   redis-server &                                    # for the *-redis scenarios
 *   node loadtest/run.mjs --out docs/thesis/results/phase_d [--duration 10] [--repeats 3] [--only node]
 *
 * Each scenario starts its server(s) fresh, runs `repeats` measurements and
 * reports the median run (and the min-max range). Servers run in monitor
 * mode, so every request goes through the full pipeline and the route
 * handler (nothing is short-circuited by a 403). The generator runs on the
 * same machine and competes for CPU: absolute numbers are a lower bound for
 * this hardware; compare scenarios with each other.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLoad } from './generator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const OUT = path.resolve(args.out ?? path.join(ROOT, 'docs/thesis/results/phase_d'));
const DURATION = Number(args.duration ?? 10);
const REPEATS = Number(args.repeats ?? 3);
const CONNECTIONS = Number(args.connections ?? 32);
const PYTHON = process.env.PYTHON ?? 'python3';
const REDIS_URL = process.env.AEGIS_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/9';

const CHROME = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="141", "Google Chrome";v="141"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
};

/** A human-like SDK telemetry payload (same shape as packages/js-sdk buildTelemetry). */
const TELEMETRY = {
  v: 1, siteKey: 'load-site', streamId: 'load-1', timestamp: 1,
  features: {
    mouse: { mouse_avg_velocity: 420, mouse_velocity_std: 180, mouse_max_velocity: 1500, mouse_avg_acceleration: 30,
      mouse_acceleration_std: 900, mouse_avg_jerk: 20000, mouse_straightness_index: 0.78, mouse_curvature_score: 0.2,
      mouse_click_precision: 0.7, mouse_micro_tremor_freq: 9.5, mouse_fitts_law_r2: 0.8, mouse_direction_changes: 30,
      mouse_pause_count: 12, mouse_avg_pause_duration: 640, mouse_event_count: 210 },
    keyboard: { kb_avg_dwell_time: 105, kb_dwell_time_std: 30, kb_avg_flight_time: 170, kb_flight_time_std: 80,
      kb_typing_speed: 48, kb_paste_count: 0, kb_correction_ratio: 0.06, kb_cadence_entropy: 4.1, kb_total_events: 60, kb_total_duration: 9.5 },
    scroll: {}, touch: {},
    fingerprint: { has_webgl: 1, has_canvas: 1, plugin_count: 5, is_headless: 0, headless_confidence: 0 },
  },
  behavioral: { isHeadless: false, mouse: { eventCount: 210, avgVelocity: 420, velocityStd: 180, avgAcceleration: 30, avgJerk: 2e4,
    straightnessIndex: 0.78, clickCount: 4, clickPrecision: 0.7, microTremorFreq: 9.5, fittsLawR2: 0.8, samples: [] },
  keyboard: { eventCount: 60, avgDwellTime: 105, dwellTimeStd: 30, avgFlightTime: 170, flightTimeStd: 80, typingSpeed: 48,
    pasteCount: 0, correctionRatio: 0.06, cadenceEntropy: 4.1 } },
  headlessChecks: [],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await sleep(200);
  }
  throw new Error(`${url} did not come up`);
}

function start(cmd, argv, env, readyUrl) {
  const proc = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  return { proc, ready: waitFor(readyUrl).catch(e => { throw new Error(`${e.message}\n${stderr}`); }) };
}

function rssMb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    return Number(/VmRSS:\s+(\d+)/.exec(status)[1]) / 1024;
  } catch { return null; }
}

async function stop(proc) {
  if (proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await Promise.race([new Promise(r => proc.once('exit', r)), sleep(5000).then(() => proc.kill('SIGKILL'))]);
}

const nodeServer = (env, port = 3300) => start('node', ['loadtest/node-server.cjs'], { PORT: String(port), ...env }, `http://127.0.0.1:${port}/health`);
const pyServer = (env, workers = 1, port = 3301) => start(PYTHON, ['-m', 'uvicorn', 'python_server:app', '--app-dir', 'loadtest', '--port', String(port),
  '--log-level', 'warning', '--no-access-log', '--workers', String(workers)], env, `http://127.0.0.1:${port}/health`);

let modelPath;
function model() {
  if (!modelPath) {
    modelPath = path.join(os.tmpdir(), `aegis-load-model-${process.pid}.pkl`);
    execFileSync(PYTHON, [path.join(ROOT, 'e2e/train_model.py'), modelPath], { stdio: 'ignore' });
  }
  return modelPath;
}

function flushRedis() {
  try { execFileSync('redis-cli', ['-u', REDIS_URL, 'flushdb'], { stdio: 'ignore' }); } catch { /* redis-cli optional */ }
}

const SCENARIOS = [
  { id: 'node-baseline', group: 'node', label: 'Express, no AEGIS', servers: () => [nodeServer({ AEGIS: 'off' })], request: { url: 'http://127.0.0.1:3300/page', headers: CHROME } },
  { id: 'node-aegis-memory', group: 'node', label: 'Express + AEGIS (in-process state)', servers: () => [nodeServer({})], request: { url: 'http://127.0.0.1:3300/page', headers: CHROME } },
  { id: 'node-aegis-redis', group: 'node', label: 'Express + AEGIS (Redis state)', redis: true, servers: () => [nodeServer({ AEGIS_REDIS_URL: REDIS_URL })], request: { url: 'http://127.0.0.1:3300/page', headers: CHROME } },
  { id: 'node-telemetry', group: 'node', label: 'Express telemetry, rules only', servers: () => [nodeServer({})], request: { url: 'http://127.0.0.1:3300/aegis/telemetry', method: 'POST', headers: CHROME, body: TELEMETRY } },
  {
    id: 'node-telemetry-ml', group: 'node', label: 'Express telemetry + ML service (HTTP)',
    servers: () => [
      start(PYTHON, ['-m', 'uvicorn', 'aegis_ml.server:app', '--port', '8011', '--log-level', 'warning', '--no-access-log'], { MODEL_PATH: model() }, 'http://127.0.0.1:8011/health'),
      nodeServer({ AEGIS_ML_URL: 'http://127.0.0.1:8011' }),
    ],
    request: { url: 'http://127.0.0.1:3300/aegis/telemetry', method: 'POST', headers: CHROME, body: TELEMETRY },
  },
  { id: 'python-baseline', group: 'python', label: 'FastAPI, no AEGIS', servers: () => [pyServer({ AEGIS: 'off' })], request: { url: 'http://127.0.0.1:3301/page', headers: CHROME } },
  { id: 'python-aegis-memory', group: 'python', label: 'FastAPI + AEGIS (in-process state)', servers: () => [pyServer({})], request: { url: 'http://127.0.0.1:3301/page', headers: CHROME } },
  { id: 'python-aegis-redis', group: 'python', label: 'FastAPI + AEGIS (Redis state)', redis: true, servers: () => [pyServer({ AEGIS_REDIS_URL: REDIS_URL })], request: { url: 'http://127.0.0.1:3301/page', headers: CHROME } },
  // 128 connections: keep-alive connections stay with the worker that accepted them, and with 32
  // most landed on one worker (measured: one at 68% CPU, three at 9-17%), hiding the scaling
  { id: 'python-aegis-redis-4w', group: 'python', label: 'FastAPI + AEGIS (Redis state), 4 workers, 128 connections', redis: true, connections: 128, servers: () => [pyServer({ AEGIS_REDIS_URL: REDIS_URL }, 4)], request: { url: 'http://127.0.0.1:3301/page', headers: CHROME } },
  { id: 'python-telemetry', group: 'python', label: 'FastAPI telemetry, rules only', servers: () => [pyServer({})], request: { url: 'http://127.0.0.1:3301/aegis/telemetry', method: 'POST', headers: CHROME, body: TELEMETRY } },
  { id: 'python-telemetry-ml', group: 'python', label: 'FastAPI telemetry + ML in-process', servers: () => [pyServer({ AEGIS_ML_MODEL_PATH: model() })], request: { url: 'http://127.0.0.1:3301/aegis/telemetry', method: 'POST', headers: CHROME, body: TELEMETRY } },
];

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  if (args['report-only']) {
    const saved = JSON.parse(fs.readFileSync(path.join(OUT, 'load_test.json'), 'utf8'));
    writeReport(saved.environment, saved.results);
    return;
  }
  const selected = SCENARIOS.filter(s => !args.only || s.group === args.only || s.id === args.only);
  const results = [];
  for (const scenario of selected) {
    if (scenario.redis) flushRedis();
    const started = scenario.servers();
    try {
      await Promise.all(started.map(s => s.ready));
      const runs = [];
      for (let i = 0; i < REPEATS; i++) {
        runs.push(await runLoad({ ...scenario.request, connections: scenario.connections ?? CONNECTIONS, durationSec: DURATION, warmupSec: i === 0 ? 3 : 1 }));
      }
      const server = started[started.length - 1].proc;
      const rss = scenario.id.endsWith('-4w') ? null : rssMb(server.pid);
      // Latency without queueing: one connection, one request at a time
      const unloaded = await runLoad({ ...scenario.request, connections: 1, durationSec: Math.min(5, DURATION), warmupSec: 1 });
      const byRps = [...runs].sort((a, b) => a.rps - b.rps);
      const med = byRps[Math.floor(byRps.length / 2)];
      const result = {
        id: scenario.id, label: scenario.label, ...med,
        rpsRange: [byRps[0].rps, byRps[byRps.length - 1].rps],
        p99Range: [Math.min(...runs.map(r => r.latencyMs.p99)), Math.max(...runs.map(r => r.latencyMs.p99))],
        medianP95: median(runs.map(r => r.latencyMs.p95)),
        // uvicorn --workers: the parent only supervises, so RSS is not comparable
        serverRssMb: rss,
        // Server time per request at saturation (one process): 1 / throughput
        serviceMs: 1000 / med.rps,
        unloadedMs: { p50: unloaded.latencyMs.p50, p99: unloaded.latencyMs.p99, rps: unloaded.rps },
        runs: runs.map(r => ({ rps: r.rps, p50: r.latencyMs.p50, p95: r.latencyMs.p95, p99: r.latencyMs.p99, errors: r.errors })),
      };
      results.push(result);
      console.log(`${scenario.id.padEnd(22)} ${result.rps.toFixed(0).padStart(6)} req/s  p50 ${result.latencyMs.p50.toFixed(2)}  p95 ${result.latencyMs.p95.toFixed(2)}  p99 ${result.latencyMs.p99.toFixed(2)} ms  statuses ${JSON.stringify(result.statuses)}`);
    } finally {
      for (const s of started.reverse()) await stop(s.proc);
    }
  }
  if (modelPath) fs.rmSync(modelPath, { force: true });

  const environment = {
    date: new Date().toISOString(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1),
    node: process.version, python: execFileSync(PYTHON, ['--version']).toString().trim(), platform: `${os.type()} ${os.release()}`,
    connections: CONNECTIONS, durationSec: DURATION, repeats: REPEATS,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'load_test.json'), JSON.stringify({ environment, results }, null, 2) + '\n');
  writeReport(environment, results);
}

function writeReport(environment, results) {
  const { connections: CONNECTIONS, durationSec: DURATION, repeats: REPEATS } = environment;

  const baseline = Object.fromEntries(results.map(r => [r.id, r]));
  const added = (id, base) => {
    const a = baseline[id], b = baseline[base];
    if (!a || !b) return '–';
    return `+${(a.unloadedMs.p50 - b.unloadedMs.p50).toFixed(2)} ms unloaded p50, +${(a.serviceMs - b.serviceMs).toFixed(3)} ms server time per request`;
  };
  const fmt = n => (Number.isFinite(n) ? n.toFixed(2) : '–');
  const lines = [
    '# Phase D load test',
    '',
    `Generated by \`node loadtest/run.mjs\` on ${environment.date.slice(0, 10)}.`,
    '',
    `Machine: ${environment.cpu ?? 'unknown CPU'}, ${environment.cpus} vCPUs, ${environment.memoryGb} GB; ${environment.platform};`,
    `Node ${environment.node}, ${environment.python}. ${CONNECTIONS} concurrent keep-alive connections, ${DURATION} s per run,`,
    `${REPEATS} runs per scenario (median run shown, range in brackets). One server process (Node) / one uvicorn worker (Python)`,
    'unless the scenario says otherwise; the ML service is one uvicorn worker.',
    'The load generator and Redis run on the same machine and take CPU from the server, so the absolute',
    'numbers are a lower bound for this hardware. Each request comes from a random 10.x.x.x client address',
    '(X-Forwarded-For), so per-IP limits are evaluated but not triggered. Servers run in monitor mode.',
    '',
    '**Under load** (saturated: latency includes queueing, p50 ≈ connections / throughput):',
    '',
    '| Scenario | req/s [range] | p50 ms | p95 ms | p99 ms [range] | Errors | Server RSS MB |',
    '|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.label} | ${r.rps.toFixed(0)} [${r.rpsRange[0].toFixed(0)}–${r.rpsRange[1].toFixed(0)}] | ${fmt(r.latencyMs.p50)} | ${fmt(r.latencyMs.p95)} | ${fmt(r.latencyMs.p99)} [${fmt(r.p99Range[0])}–${fmt(r.p99Range[1])}] | ${r.errors} | ${r.serverRssMb?.toFixed(0) ?? '–'} |`),
    '',
    '**Unloaded** (one connection, one request at a time, 5 s): the latency a single client sees.',
    '',
    '| Scenario | p50 ms | p99 ms |',
    '|---|---|---|',
    ...results.map(r => `| ${r.label} | ${fmt(r.unloadedMs.p50)} | ${fmt(r.unloadedMs.p99)} |`),
    '',
    'Cost of AEGIS on a page request:',
    '',
    `- Node, in-process state: ${added('node-aegis-memory', 'node-baseline')}`,
    `- Node, Redis state: ${added('node-aegis-redis', 'node-baseline')}`,
    `- Python, in-process state: ${added('python-aegis-memory', 'python-baseline')}`,
    `- Python, Redis state: ${added('python-aegis-redis', 'python-baseline')}`,
    '',
    ...(baseline['python-aegis-redis-4w'] ? [
      'The 4-worker row shows scale-out with shared Redis state, not per-request cost. Its latencies',
      'include a uvicorn artefact: with `--workers 4` (uvicorn 0.50) every keep-alive request takes about',
      '44 ms even without AEGIS (measured: 43.9 ms vs 0.68 ms with one worker), so compare its throughput only.',
      '',
    ] : []),
    'Server time per request = 1 / throughput of the single saturated server process.',
    'RSS is read at the end of the scenario; every request comes from a new simulated client,',
    'so in-process state (sessions, per-IP counters) grows with the number of distinct clients.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'load_test.md'), lines.join('\n'));
  console.log(`\nwrote ${path.relative(ROOT, OUT)}/load_test.{json,md}`);
}

main().catch(e => { console.error(e); process.exit(1); });
