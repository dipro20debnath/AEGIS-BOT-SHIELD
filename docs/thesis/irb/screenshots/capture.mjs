/**
 * Screenshots of the study website for the ethics application (protocol §10).
 *
 *   npm run build                                   # SDK bundle used by the site
 *   node docs/thesis/irb/screenshots/capture.mjs
 *
 * Starts the study site on a temporary database, walks through it as a
 * participant (Bangla, plus the English consent page and two phone-size
 * views) and writes PNG files next to this script. Re-run it after filling in
 * the information sheets, so the committee sees the final text.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = dirname(fileURLToPath(import.meta.url));
const root = join(out, '..', '..', '..', '..');
const PYTHON = process.env.PYTHON ?? 'python3';
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, STUDY_DB: join(mkdtempSync(join(tmpdir(), 'aegis-shots-')), 'study.db'),
  AEGIS_SECRET_KEY: 'screenshot-secret-0123456789abcdef' };
const study = (...a) => execFileSync(PYTHON, ['-m', 'aegis_study', ...a], { cwd: join(root, 'study'), env, encoding: 'utf8' }).trim();

const server = spawn(PYTHON, ['-m', 'uvicorn', 'aegis_study.app:app', '--app-dir', 'study', '--port', String(PORT)],
  { cwd: root, env, stdio: 'ignore' });
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 250));
  }
  const browser = await chromium.launch();
  const shot = async (page, name, full = false) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
    console.log(`${name}.png`);
  };

  // Desktop, Bangla: the whole participant flow
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await page.goto(BASE + '/');
  await shot(page, '01_landing');
  await page.goto(BASE + '/consent?lang=bn');
  await shot(page, '02_consent_bn', true);
  for (const box of ['c_read', 'c_aggregate', 'c_withdraw', 'c_age', 'c_raw']) await page.check(`input[name=${box}]`);
  await page.fill('#code', study('codes', '--kind', 'human', '--count', '1'));
  await Promise.all([page.waitForURL('**/survey/pre'), page.click('[data-study=start]')]);
  await shot(page, '04_survey_before', true);
  await Promise.all([page.waitForURL('**/shop/login'), page.click('[data-study=survey-next]')]);
  await shot(page, '05_task1_login');

  const bold = () => page.locator('[data-study=task-panel] b').allInnerTexts();
  const [user, password] = await bold();
  await page.fill('#username', user);
  await page.fill('#password', password);
  await Promise.all([page.waitForURL(`${BASE}/shop`), page.click('[data-study=login]')]);
  const [term] = await bold();
  await page.fill('input[name=q]', term);
  await Promise.all([page.waitForURL('**/shop/search**'), page.press('input[name=q]', 'Enter')]);
  await shot(page, '06_task2_search');
  await Promise.all([page.waitForURL('**/shop/product/**'), page.locator('[data-study=product-title]').first().click()]);

  const [category] = await bold();
  await Promise.all([page.waitForURL('**/shop/category/**'),
    page.getByRole('link', { name: category, exact: true }).first().click()]);
  await shot(page, '07_task3_compare');
  const cards = await page.locator('.product').evaluateAll(nodes => nodes.map(n => ({
    href: n.querySelector('a').getAttribute('href'),
    price: Number(n.querySelector('.price').textContent.replace(/[^0-9]/g, '')),
    rating: Number(n.querySelector('.stars').textContent.replace(/[^0-9.]/g, '')) })));
  const target = cards.filter(c => c.rating >= 4).sort((a, b) => a.price - b.price)[0];
  await page.goto(BASE + target.href);
  await Promise.all([page.waitForURL('**added=1'), page.click('[data-study=add-to-cart]')]);
  await page.goto(BASE + '/shop/cart');
  await shot(page, '08_task4_cart');

  // Leave the cart task as it is; skip to show the checkout and review pages
  for (const task of ['cart']) {
    await Promise.all([page.waitForURL('**/shop/cart'), page.evaluate((t) => {
      const form = document.querySelector('[data-study=skip]').closest('form');
      form.querySelector('[name=task]').value = t; form.submit(); }, task)]);
  }
  await page.goto(BASE + '/shop/checkout');
  await shot(page, '09_task5_checkout', true);
  await page.goto(BASE + target.href.replace('/product/', '/review/'));
  await shot(page, '10_task6_review');
  await page.goto(BASE + '/survey/post');
  await shot(page, '11_survey_after', true);
  await Promise.all([page.waitForURL('**/done'), page.click('[data-study=survey-next]')]);
  await shot(page, '12_done');

  // English information sheet
  const en = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await en.goto(BASE + '/consent?lang=en');
  await shot(en, '03_consent_en', true);

  // Phone size: consent and a task page
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(BASE + '/consent?lang=bn');
  await shot(phone, '13_phone_consent_bn');
  for (const box of ['c_read', 'c_aggregate', 'c_withdraw', 'c_age']) await phone.check(`input[name=${box}]`);
  await phone.fill('#code', study('codes', '--kind', 'human', '--count', '1'));
  await Promise.all([phone.waitForURL('**/survey/pre'), phone.click('[data-study=start]')]);
  await Promise.all([phone.waitForURL('**/shop/login'), phone.click('[data-study=survey-next]')]);
  await shot(phone, '14_phone_task1_login');

  await browser.close();
} finally {
  server.kill();
}
