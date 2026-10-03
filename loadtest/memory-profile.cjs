/**
 * Memory per distinct client in the Node server (in-process state).
 *   node --expose-gc loadtest/memory-profile.cjs [clients=20000]
 * Sends one page request per simulated client (new IP, no cookie) through
 * AegisNode.evaluate and reports heap growth and the size of every Map in the
 * engine's modules, to find state that grows without bound (each per-client
 * map is bounded to 100,000 keys by default, the bot-behaviour one to 50,000).
 */
const { AegisNode } = require('../packages/server-node/dist');

const N = Number(process.argv[2] || 20000);
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html', 'accept-language': 'en-US', 'sec-ch-ua': '"Chromium";v="141"', 'sec-fetch-dest': 'document',
};
const ip = i => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
const heap = () => { global.gc?.(); global.gc?.(); return process.memoryUsage().heapUsed; };

/** Walk an object graph (depth-limited) and report every Map/Set and array with its size. */
function collections(root, name, depth = 0, out = [], seen = new Set()) {
  if (!root || typeof root !== 'object' || seen.has(root) || depth > 4) return out;
  seen.add(root);
  if (root instanceof Map || root instanceof Set) out.push([name, root.size]);
  else if (root.constructor?.name === 'BoundedMap') { out.push([name, root.size]); return out; }
  else if (Array.isArray(root) && root.length > 100) out.push([name, root.length]);
  if (root instanceof Map) return out;
  for (const [k, v] of Object.entries(root)) collections(v, `${name}.${k}`, depth + 1, out, seen);
  return out;
}

(async () => {
  const aegis = new AegisNode({ siteKey: 's', secretKey: 'profile-secret-0123456789', mode: 'monitor', processMetrics: false,
    engine: { rateLimiting: { enabled: true } } });
  await aegis.evaluate({ method: 'GET', path: '/', ip: '10.255.255.255', headers: HEADERS });
  const before = heap();
  const t0 = process.hrtime.bigint();
  const lat = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = process.hrtime.bigint();
    await aegis.evaluate({ method: 'GET', path: '/', ip: ip(i), headers: HEADERS });
    lat[i] = Number(process.hrtime.bigint() - t) / 1e6;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  lat.sort();
  const after = heap();
  const sizes = collections(aegis, 'aegis').filter(([, n]) => n >= N / 10).sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ clients: N, heapGrowthMb: +((after - before) / 2 ** 20).toFixed(1),
    bytesPerClient: Math.round((after - before) / N), msPerRequest: +(ms / N).toFixed(3),
    p99Ms: +lat[Math.floor(N * 0.99)].toFixed(3), maxMs: +lat[N - 1].toFixed(1), over10Ms: lat.filter(t => t > 10).length,
    largeCollections: Object.fromEntries(sizes) }, null, 1));
  await aegis.shutdown();
})();
