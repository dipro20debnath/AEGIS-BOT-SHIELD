/**
 * End-to-end: real Chromium -> JS SDK (dist/aegis.min.js) -> Python middleware
 * (examples/fastapi-integration, with a trained ML model) -> token -> protected route.
 *
 * Prerequisites: npm run build; pip install -e packages/ml-engine -e "packages/server-python[test]" uvicorn
 * Run: npm run test:e2e
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PYTHON = process.env.PYTHON ?? 'python3';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const servers = [];
let browser;

async function startServer(port, mode, modelPath) {
  const proc = spawn(PYTHON, ['-m', 'uvicorn', 'main:app', '--app-dir', 'examples/fastapi-integration', '--port', String(port)], {
    env: { ...process.env, AEGIS_SITE_KEY: 'demo-site', AEGIS_SECRET_KEY: 'e2e-secret-key-0123456789abcdef', AEGIS_MODE: mode, AEGIS_ML_MODEL_PATH: modelPath },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  servers.push(proc);
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return `http://127.0.0.1:${port}`;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`server on ${port} did not start`);
}

/** Load the demo page like a "stealth" bot (normal Chrome UA, automation flag hidden) and log in. */
async function stealthLogin(base) {
  const context = await browser.newContext({ userAgent: CHROME_UA, extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
  const page = await context.newPage();
  const telemetry = [];
  let loginToken = null;
  page.on('response', async r => { if (r.url().endsWith('/aegis/telemetry')) telemetry.push({ status: r.status(), body: await r.json() }); });
  page.on('request', r => { if (r.url().endsWith('/api/login')) loginToken = r.headers()['x-aegis-token'] ?? null; });

  const pageResponse = await page.goto(base + '/');
  await page.waitForFunction(() => window.Aegis && window.Aegis.client);
  for (let i = 0; i < 30; i++) await page.mouse.move(100 + i * 9, 220 + (i % 4) * 6, { steps: 3 });
  await page.fill('input[name=username]', 'demo');
  await page.locator('input[name=password]').pressSequentially('demo', { delay: 90 });
  const [login] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/login')),
    page.click('button[type=submit]'),
  ]);
  const result = { pageStatus: pageResponse.status(), telemetry, loginToken, loginStatus: login.status(), loginBody: await login.json() };
  await context.close();
  return result;
}

let enforce, monitor;

before(async () => {
  const modelPath = join(mkdtempSync(join(tmpdir(), 'aegis-e2e-')), 'model.pkl');
  execFileSync(PYTHON, ['e2e/train_model.py', modelPath], { stdio: 'inherit' });
  [enforce, monitor] = await Promise.all([startServer(8765, 'enforce', modelPath), startServer(8766, 'monitor', modelPath)]);
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
});

after(async () => {
  await browser?.close();
  for (const proc of servers) proc.kill();
});

test('a scripted client without token is challenged on the login API', async () => {
  const response = await fetch(enforce + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'demo' }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { aegis: 'challenge', telemetry: '/aegis/telemetry' });
});

test('default headless Chromium is denied at the first page load', async () => {
  const context = await browser.newContext(); // keeps the HeadlessChrome user agent
  const page = await context.newPage();
  const response = await page.goto(enforce + '/');
  assert.equal(response.status(), 403);
  await context.close();
});

test('the SDK sends telemetry and attaches the server token to the login request (monitor mode)', async () => {
  const r = await stealthLogin(monitor);
  assert.equal(r.pageStatus, 200);
  assert.ok(r.telemetry.length >= 1, 'telemetry was posted');
  assert.equal(r.telemetry[0].status, 200);
  assert.match(r.loginToken ?? '', /^AEGIS\.v1\./, 'login request carries the token');
  assert.equal(r.loginStatus, 200);
  assert.equal(r.loginBody.success, true);
  // Automation is still visible to the SDK even with a normal user agent
  assert.ok(r.telemetry[0].body.score >= 50, `telemetry score ${r.telemetry[0].body.score}`);
});

test('the same stealth browser is blocked at login in enforce mode', async () => {
  const r = await stealthLogin(enforce);
  assert.equal(r.pageStatus, 200, 'network/header layer lets the page load');
  assert.equal(r.loginStatus, 403, 'behaviour layer blocks the login');
});
