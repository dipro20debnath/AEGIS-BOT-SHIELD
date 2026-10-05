/**
 * End-to-end: the data-collection study site (study/) in real Chromium.
 *
 * A scripted participant goes through consent (with the optional raw-timing
 * item), the survey and all six tasks. Then the dataset is exported and the
 * behavioural features are recomputed from the raw events with the SDK's own
 * collectors (study/tools/replay_features.mjs). Keyboard features must match
 * what the live SDK reported for the same page: this checks that nothing is
 * lost between the browser, the server and the export.
 *
 * Prerequisites: npm run build; pip install -e packages/server-python[test] -e study uvicorn
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PYTHON = process.env.PYTHON ?? 'python3';
const PORT = 8771;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'aegis-study-'));
const env = { ...process.env, STUDY_DB: join(dir, 'study.db'), AEGIS_SECRET_KEY: 'study-e2e-secret-0123456789' };
let server;
let browser;

const study = (...args) => execFileSync(PYTHON, ['-m', 'aegis_study', ...args], { cwd: 'study', env, encoding: 'utf8' });

before(async () => {
  server = spawn(PYTHON, ['-m', 'uvicorn', 'aegis_study.app:app', '--app-dir', 'study', '--port', String(PORT)],
    { env, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** Type like a person: per-key delays with variation. */
async function typeText(page, selector, text) {
  await page.click(selector);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 40 + Math.random() * 60 });
    await page.waitForTimeout(30 + Math.random() * 90);
  }
}

test('participant flow: consent, survey, six tasks, export and raw-event replay', async () => {
  const code = study('codes', '--kind', 'human', '--count', '1').trim();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto(BASE);
  await page.click('[data-study=lang-en]');
  for (const box of ['c_read', 'c_aggregate', 'c_withdraw', 'c_age', 'c_raw']) await page.check(`input[name=${box}]`);
  await page.fill('#code', code);
  await page.click('[data-study=start]');
  await page.waitForURL('**/survey/pre');
  await page.check('input[name=device][value=laptop]');
  await page.check('input[name=input][value=mouse]');
  await page.click('[data-study=survey-next]');
  await page.waitForURL('**/shop/login');

  // Task texts come from the server; read this session's targets from the task panel
  const panel = async () => page.locator('[data-study=task-panel]').innerText();
  const bold = async () => page.locator('[data-study=task-panel] b').allInnerTexts();

  const [username, password] = await bold();
  await page.mouse.move(200, 200, { steps: 15 });
  await typeText(page, '#username', username);
  await typeText(page, '#password', password);
  await page.click('[data-study=login]');
  await page.waitForURL(`${BASE}/shop`);

  const [term] = await bold();
  await typeText(page, 'input[name=q]', term);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/shop/search**');
  await page.locator('[data-study=product-title]').first().click();
  await page.waitForURL('**/shop/product/**');

  const [categoryName] = await bold();
  await page.getByRole('link', { name: categoryName, exact: true }).first().click();
  await page.waitForURL('**/shop/category/**');
  await page.mouse.wheel(0, 400);
  // The shop is a test fixture: find the cheapest product rated >= 4.0 from the listing
  const cards = await page.locator('.product').evaluateAll(nodes => nodes.map(n => ({
    href: n.querySelector('a').getAttribute('href'),
    price: Number(n.querySelector('.price').textContent.replace(/[^0-9]/g, '')),
    rating: Number(n.querySelector('.stars').textContent.replace(/[^0-9.]/g, '')),
  })));
  const target = cards.filter(c => c.rating >= 4).sort((a, b) => a.price - b.price)[0];
  await page.goto(BASE + target.href);
  await page.click('[data-study=add-to-cart]');
  await page.waitForURL('**added=1');

  const cartTask = await bold(); // [quantity, decoy name]
  await page.click('[data-study=cart]');
  await page.waitForURL('**/shop/cart');
  const targetRow = page.locator('tr', { has: page.locator(`a[href="${target.href}"]`) });
  await targetRow.locator('input[name=quantity]').fill(cartTask[0]);
  await targetRow.locator('[data-study=update-qty]').click();
  await page.waitForURL('**/shop/cart');
  await page.locator('tr', { hasText: cartTask[1] }).locator('[data-study=remove]').click();
  await page.waitForURL('**/shop/cart');
  assert.match(await panel(), /5\/6/); // cart task done -> checkout

  const d = await bold(); // name, phone, address, city, option
  const postcode = (await panel()).match(/\b(\d{4})\b/)[1];
  await page.click('[data-study=checkout]');
  await typeText(page, '#name', d[0]);
  await typeText(page, '#phone', d[1]);
  await typeText(page, '#address', d[2]);
  await page.selectOption('#city', d[3]);
  await typeText(page, '#postcode', postcode);
  await page.check(`input[name=option][value=${d[4].toLowerCase()}]`);
  await typeText(page, '#note', 'After five in the evening please.');
  await page.click('[data-study=place-order]');
  await page.waitForSelector('.notice');

  await page.goto(BASE + target.href);
  await page.click('[data-study=write-review]');
  await typeText(page, '#text', 'Works well and the price is fair.');
  await page.check('input[name=rating][value="4"]');
  await page.click('[data-study=submit-review]');
  await page.waitForSelector('.notice');
  assert.match(await panel(), /All tasks are done/);

  await page.click('[data-study=finish]');
  await page.waitForURL('**/survey/post');
  await page.check('input[name=autofill][value=no]');
  await page.click('[data-study=survey-next]');
  await page.waitForURL('**/done');
  await context.close();
  await new Promise(r => setTimeout(r, 500)); // let the last beacons arrive

  const stats = JSON.parse(study('stats'));
  assert.equal(stats.sessions['human/completed'], 1);
  assert.ok(stats.telemetry_records >= 6, `telemetry records: ${stats.telemetry_records}`);
  assert.ok(stats.raw_events > 500, `raw events: ${stats.raw_events}`);

  const out = join(dir, 'dataset');
  study('export', '--out', out, '--no-parquet');
  const sessions = csv(readFileSync(join(out, 'sessions.csv'), 'utf8'));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tasks_completed, '6');
  assert.equal(sessions[0].raw_consent, '1');
  assert.equal(sessions[0].pre_device, 'laptop');

  execFileSync('node', ['study/tools/replay_features.mjs', out], { stdio: 'inherit' });
  const replayed = csv(readFileSync(join(out, 'replayed_features.csv'), 'utf8'));
  const telemetry = csv(readFileSync(join(out, 'telemetry.csv'), 'utf8'));
  // Every page view: the final live snapshot vs the replay of its raw events, joined by
  // the shared page-view id (SDK streamId = recorder page_view)
  const byView = new Map(replayed.filter(r => r.cutoff_s === '').map(r => [r.page_view, r]));
  const finals = telemetry.filter(r => r.is_final === '1');
  assert.ok(finals.length >= 8, `final snapshots: ${finals.length}`);
  let typed = 0;
  for (const live of finals) {
    const replay = byView.get(live.stream);
    assert.ok(replay, `raw events for page view ${live.stream} (${live.page})`);
    if (Number(live.kb_avg_dwell_time) > 0) typed++;
    for (const key of ['kb_avg_dwell_time', 'kb_avg_flight_time', 'kb_correction_ratio', 'kb_paste_count']) {
      assert.ok(Math.abs(Number(live[key]) - Number(replay[key])) < 0.5,
        `${live.page} ${key}: live ${live[key]} vs replay ${replay[key]}`);
    }
  }
  assert.ok(typed >= 4, `page views with typing: ${typed}`); // login, search, checkout, review
  assert.ok(existsSync(join(out, 'manifest.json')));
});

function csv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/); // Python's csv module writes CRLF
  const cols = head.split(',');
  // Only simple columns are compared; JSON columns may contain commas, so parse with quotes in mind
  return lines.map(line => {
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { cur += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}
