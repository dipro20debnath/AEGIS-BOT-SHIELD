/**
 * Closed-loop HTTP load generator: `connections` clients, each sending its
 * next request as soon as the previous answer arrives, for `durationSec`
 * after `warmupSec`. Every latency is recorded, so percentiles are exact
 * (no histogram buckets). With randomIp, each request carries a random
 * X-Forwarded-For from 10.0.0.0/8, i.e. many distinct clients, so per-IP rate
 * limits are evaluated but not triggered.
 */
import http from 'node:http';

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const randomIp = () => `10.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}.${1 + ((Math.random() * 254) | 0)}`;

export async function runLoad({ url, method = 'GET', headers = {}, body, connections = 32, durationSec = 15, warmupSec = 3, randomIps = true }) {
  const target = new URL(url);
  const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
  const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const latencies = [];
  const statuses = {};
  let errors = 0;
  let measuring = false;
  let stop = false;

  const once = () => new Promise(resolve => {
    const h = { ...headers };
    if (randomIps) h['x-forwarded-for'] = randomIp();
    if (payload) { h['content-type'] ??= 'application/json'; h['content-length'] = payload.length; }
    const start = process.hrtime.bigint();
    const req = http.request({ agent, host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers: h }, res => {
      res.resume();
      res.on('end', () => {
        if (measuring) {
          latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
          statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1;
        }
        resolve();
      });
    });
    req.on('error', () => { if (measuring) errors++; resolve(); });
    if (payload) req.write(payload);
    req.end();
  });

  const client = async () => { while (!stop) await once(); };
  const clients = Array.from({ length: connections }, client);
  await new Promise(r => setTimeout(r, warmupSec * 1000));
  measuring = true;
  const t0 = process.hrtime.bigint();
  await new Promise(r => setTimeout(r, durationSec * 1000));
  measuring = false;
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;
  stop = true;
  await Promise.all(clients);
  agent.destroy();

  const sorted = Float64Array.from(latencies).sort();
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);
  return {
    requests: sorted.length,
    rps: sorted.length / elapsed,
    latencyMs: {
      mean, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1] ?? NaN,
    },
    statuses, errors, connections, durationSec: elapsed,
  };
}
