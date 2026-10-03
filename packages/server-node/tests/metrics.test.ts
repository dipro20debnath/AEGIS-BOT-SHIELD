import express from 'express';
import request from 'supertest';
import { AegisNode, AegisStore, aegisExpress, aegisRoutes } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY, telemetry } from './fixtures';

function app(aegis: AegisNode): express.Express {
  const a = express();
  a.use(express.json());
  a.use(aegisExpress(aegis.options, aegis));
  a.use(aegisRoutes(aegis));
  a.get('/page', (_req, res) => { res.send('ok'); });
  return a;
}

describe('Prometheus metrics and probes', () => {
  const aegis = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET, excludedPaths: ['/aegis/'], processMetrics: false });
  const server = app(aegis);
  afterAll(() => aegis.shutdown());

  it('counts decisions, signals and durations by kind', async () => {
    await request(server).get('/page').set(BROWSER_HEADERS);
    await request(server).get('/page').set('User-Agent', 'curl/8.0');
    await request(server).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(true));
    const res = await request(server).get('/aegis/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/aegis_decisions_total\{kind="request",verdict="allow"\} 1/);
    expect(res.text).toMatch(/aegis_decisions_total\{kind="request",verdict="(challenge|block)"\} 1/);
    expect(res.text).toMatch(/aegis_decisions_total\{kind="telemetry",verdict="allow"\} 1/);
    expect(res.text).toMatch(/aegis_signals_total\{signal="[^"]+"\} \d+/);
    expect(res.text).toMatch(/aegis_decision_duration_seconds_count\{kind="request"\} 2/);
    expect(res.text).toMatch(/aegis_sessions \d+/);
  });

  it('includes process metrics unless disabled', async () => {
    const withProcess = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET });
    expect(await withProcess.metrics.text()).toContain('aegis_node_process_resident_memory_bytes');
    await withProcess.shutdown();
  });

  it('is ready, and not ready while the shared store is down', async () => {
    expect((await request(server).get('/aegis/ready')).body).toEqual({ ready: true, checks: { engine: 'ok' } });
    const down: AegisStore = {
      claimOnce: async () => { throw new Error('down'); }, hit: async () => { throw new Error('down'); },
      get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); }, close: async () => undefined,
    };
    const broken = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET, store: down, excludedPaths: ['/aegis/'], processMetrics: false });
    const res = await request(app(broken)).get('/aegis/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.store).toBe('unreachable');
    await request(app(broken)).get('/page').set(BROWSER_HEADERS);
    expect(await broken.metrics.text()).toMatch(/aegis_store_errors_total\{operation="session_get"\} [1-9]/);
    await broken.shutdown();
  });
});
