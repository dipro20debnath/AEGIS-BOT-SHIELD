/**
 * Bot sessions for the data-collection study site (study/): the bot goes
 * through the same consent -> survey -> six tasks -> survey flow as people,
 * reading the task panel, so bot and human data are directly comparable.
 *
 *   python -m aegis_study codes --kind bot --tool playwright-human --count 10 --config '{"mode":"human"}' > codes.txt
 *   xvfb-run -a node bots/study_bot.mjs --driver playwright --mode human --target https://study.example --codes codes.txt
 *
 * --driver playwright | puppeteer   (puppeteer uses puppeteer-extra-plugin-stealth)
 * --mode   fast    element clicks at the centre, instant typing (T2)
 *          stealth automation flag hidden, Chrome user agent, centre clicks, constant typing delay (T3)
 *          human   headed browser, Bezier mouse paths with jitter, varied click points, reading pauses,
 *                  wheel scrolling, irregular typing with occasional typos corrected by Backspace (T4-like)
 * --codes  file with one bot study code per line; one code per run (so each run is its own
 *          "participant" in the dataset and cross-validation can keep runs apart)
 * --code   a single code instead of --codes
 * --seed   random seed of the per-run behaviour parameters (printed with the result)
 *
 * Only run it against the study site you operate.
 */
import { readFileSync } from 'node:fs';
import { CHROME_UA, CHROMIUM, humanPath, sleep } from './common.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const target = arg('target', 'http://localhost:8000').replace(/\/$/, '');
const driver = arg('driver', 'playwright');
const mode = arg('mode', 'stealth');
const codes = arg('codes') ? readFileSync(arg('codes'), 'utf8').split(/\s+/).filter(Boolean) : [arg('code')].filter(Boolean);
if (!codes.length) { console.error('give --code B-XXXXXXXX or --codes file'); process.exit(2); }
if (!['fast', 'stealth', 'human'].includes(mode)) { console.error('--mode fast|stealth|human'); process.exit(2); }

// Small seeded PRNG so a run's behaviour can be reproduced from its seed
function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function launch() {
  if (driver === 'puppeteer') {
    const { default: puppeteerCore } = await import('puppeteer-core');
    const { addExtra } = await import('puppeteer-extra');
    const { default: Stealth } = await import('puppeteer-extra-plugin-stealth');
    const puppeteer = addExtra(puppeteerCore);
    if (mode !== 'fast') puppeteer.use(Stealth());
    const browser = await puppeteer.launch({ executablePath: CHROMIUM, headless: mode !== 'human',
      args: ['--no-sandbox', '--window-size=1280,900'], defaultViewport: { width: 1280, height: 800 } });
    const page = await browser.newPage();
    return { browser, page, select: (sel, v) => page.select(sel, v), wheel: (dy) => page.mouse.wheel({ deltaY: dy }),
      nav: async (action) => { await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }), action()]); } };
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: mode !== 'human',
    args: mode === 'fast' ? [] : ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US',
    userAgent: mode === 'stealth' ? CHROME_UA : undefined });
  const page = await context.newPage();
  return { browser, page, select: (sel, v) => page.selectOption(sel, v), wheel: (dy) => page.mouse.wheel(0, dy),
    nav: async (action) => { await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }), action()]); } };
}

async function session(code, seed) {
  const rnd = prng(seed);
  const between = (a, b) => a + rnd() * (b - a);
  // Per-run behaviour parameters (human mode): speed and error rate differ between runs like between people
  const p = { speed: between(0.7, 1.4), typoRate: between(0, 0.04), dwell: [between(60, 90), between(100, 160)],
    flight: [between(60, 110), between(160, 320)], readMs: [between(400, 900), between(1200, 2600)] };
  const { browser, page, select, wheel, nav } = await launch();
  let pos = [between(300, 900), between(150, 500)];
  const pause = (range) => sleep(between(range[0], range[1]) / p.speed);

  const box = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vh: window.innerHeight };
  }, sel);

  async function reveal(sel) {
    for (let i = 0; i < 12; i++) {
      const b = await box(sel);
      if (!b) throw new Error(`missing ${sel}`);
      if (b.y >= 60 && b.y + b.h <= b.vh - 20) return b;
      if (mode === 'human') { await wheel(Math.sign(b.y - b.vh / 2) * between(90, 180)); await sleep(between(120, 260)); }
      else { await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); }
    }
    return box(sel);
  }

  async function click(sel, navigates = false) {
    const go = async () => {
      if (mode === 'human') {
        const b = await reveal(sel);
        const to = [b.x + b.w * between(0.25, 0.75), b.y + b.h * between(0.3, 0.7)];
        for (const [x, y] of humanPath(pos[0], pos[1], to[0], to[1])) { await page.mouse.move(x, y); await sleep(between(5, 16) / p.speed); }
        pos = to;
        await page.mouse.down(); await sleep(between(60, 140)); await page.mouse.up();
      } else {
        await page.click(sel);
      }
    };
    if (navigates) await nav(go); else await go();
  }

  async function type(sel, text, focused = false) {
    if (!focused) await click(sel);   // focused: the field already has focus and a selection to type over
    if (mode === 'fast') { await page.keyboard.type(text); return; }
    if (mode === 'stealth') { await page.keyboard.type(text, { delay: 35 }); return; }
    for (const ch of text) {
      if (/[a-z]/i.test(ch) && rnd() < p.typoRate) {           // a typo, noticed and corrected
        const wrong = String.fromCharCode(97 + Math.floor(rnd() * 26));
        await page.keyboard.down(wrong); await sleep(between(...p.dwell)); await page.keyboard.up(wrong);
        await sleep(between(150, 450));
        await page.keyboard.down('Backspace'); await sleep(between(...p.dwell)); await page.keyboard.up('Backspace');
        await sleep(between(...p.flight));
      }
      await page.keyboard.down(ch); await sleep(between(...p.dwell) / p.speed); await page.keyboard.up(ch);
      await sleep(between(...p.flight) / p.speed);
    }
  }

  const panel = () => page.evaluate(() => {
    const el = document.querySelector('[data-study=task-panel]');
    return el ? { task: el.dataset.task, bold: [...el.querySelectorAll('b')].map(b => b.textContent),
      text: el.textContent } : null;
  });

  const result = { bot: `${driver}-${mode}`, code, seed, params: p, tasks: {}, error: null };
  try {
    await page.goto(target + '/', { waitUntil: 'load' });
    await click('[data-study=lang-en]', true);
    for (const name of ['c_read', 'c_aggregate', 'c_withdraw', 'c_age', 'c_raw']) await click(`input[name=${name}]`);
    await type('#code', code);
    await click('[data-study=start]', true);
    await click('[data-study=survey-next]', true);

    const nouns = ['morning', 'evening', 'afternoon', 'weekend', 'Friday', 'Sunday'];
    for (let guard = 0; guard < 30; guard++) {
      const t = await panel();
      if (!t || t.task === 'done') break;
      await pause(p.readMs);
      const started = Date.now();
      if (t.task === 'login') {
        if (!page.url().includes('/shop/login')) await page.goto(target + '/shop/login');
        await type('#username', t.bold[0]);
        await type('#password', t.bold[1]);
        await click('[data-study=login]', true);
      } else if (t.task === 'search') {
        await type('input[name=q]', t.bold[0]);
        await nav(() => page.keyboard.press('Enter'));
        await click('[data-study=product-title]', true);
      } else if (t.task === 'compare') {
        const cat = await page.evaluate((name) => [...document.querySelectorAll('.cats a')]
          .find(a => a.textContent.trim() === name)?.getAttribute('data-study'), t.bold[0]);
        await click(`[data-study="${cat}"]`, true);
        const cards = await page.evaluate(() => [...document.querySelectorAll('.product')].map(n => ({
          id: n.querySelector('a').getAttribute('href').split('/').pop(),
          price: Number(n.querySelector('.price').textContent.replace(/[^0-9]/g, '')),
          rating: Number(n.querySelector('.stars').textContent.replace(/[^0-9.]/g, '')) })));
        if (mode === 'human') for (let i = 0; i < 3; i++) { await wheel(between(120, 300)); await sleep(between(300, 900)); }
        const best = cards.filter(c => c.rating >= 4).sort((a, b) => a.price - b.price)[0];
        await click(`[data-study="product-${best.id}"]`, true);
        await click('[data-study=add-to-cart]', true);
      } else if (t.task === 'cart') {
        await click('[data-study=cart]', true);
        const [quantity, decoy] = t.bold;
        const rows = await page.evaluate((d) => [...document.querySelectorAll('tr')].map((tr, i) => ({ i, decoy: tr.textContent.includes(d) })), decoy);
        const keep = rows.find(r => !r.decoy);
        const qtySel = `tr:nth-child(${keep.i + 1}) input[name=quantity]`;
        if (mode === 'human') {   // select the old value with the keyboard, like a person
          await click(qtySel);
          await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
        } else {                  // scripts usually clear the field directly
          await page.evaluate((s) => { document.querySelector(s).value = ''; }, qtySel);
        }
        await type(qtySel, quantity, mode === 'human');
        await click(`tr:nth-child(${keep.i + 1}) [data-study=update-qty]`, true);
        const decoyRow = (await page.evaluate((d) => [...document.querySelectorAll('tr')].findIndex(tr => tr.textContent.includes(d)), decoy));
        if (decoyRow >= 0) await click(`tr:nth-child(${decoyRow + 1}) [data-study=remove]`, true);
      } else if (t.task === 'checkout') {
        const [name, phone, address, city, option] = t.bold;
        const postcode = t.text.match(/\b(\d{4})\b/)[1];
        await click('[data-study=checkout]', true);
        await type('#name', name);
        await type('#phone', phone);
        await type('#address', address);
        await click('#city'); await select('#city', city);
        await type('#postcode', postcode);
        await click(`input[name=option][value=${option.toLowerCase()}]`);
        await type('#note', `Please deliver in the ${nouns[Math.floor(rnd() * nouns.length)]}.`);
        await click('[data-study=place-order]', true);
      } else if (t.task === 'review') {
        const id = await page.evaluate((name) => [...document.querySelectorAll('a')].find(a => a.textContent.trim() === name)?.getAttribute('href'), t.bold[0]);
        await page.goto(target + (id || '/shop'));
        if (!id) {
          await type('input[name=q]', t.bold[0]);
          await nav(() => page.keyboard.press('Enter'));
          await click('[data-study=product-title]', true);
        }
        await click('[data-study=write-review]', true);
        await type('#text', 'Good product for the price and it works as described.');
        await click(`input[name=rating][value="${1 + Math.floor(rnd() * 5)}"]`);
        await click('[data-study=submit-review]', true);
      }
      const after = await panel();
      result.tasks[t.task] = { ok: after?.task !== t.task, seconds: (Date.now() - started) / 1000 };
      if (after?.task === t.task) {        // could not do it: skip like a person would
        await nav(() => page.evaluate(() => document.querySelector('[data-study=skip]').closest('form').submit()));
      }
    }
    await click('[data-study=finish]', true);
    await click('[data-study=survey-next]', true);
    result.finished = page.url().endsWith('/done');
  } catch (err) {
    result.error = String(err.message || err).slice(0, 300);
  } finally {
    await browser.close();
  }
  return result;
}

for (const [i, code] of codes.entries()) {
  const seed = Number(arg('seed', Date.now() % 1e9)) + i;
  console.log(JSON.stringify(await session(code, seed)));
}
