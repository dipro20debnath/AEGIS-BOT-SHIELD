/**
 * T3 bot: Puppeteer with puppeteer-extra-plugin-stealth (hides navigator.webdriver,
 * fakes plugins/languages/WebGL vendor, patches the HeadlessChrome user agent).
 * Types with fixed short delays and clicks the button directly.
 *
 *   node bots/puppeteer_stealth_bot.mjs --target http://localhost:8000 --runs 3
 */
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import { CHROMIUM, credentials, emit, parseArgs, recorder, settle } from './common.mjs';

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(Stealth());
const { target, runs } = parseArgs();

for (let run = 0; run < runs; run++) {
  const browser = await puppeteer.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const log = recorder(page, cb => page.on('response', async r => cb(r.url(), r.status(), await r.json().catch(() => null))));
    const res = await page.goto(target + '/', { waitUntil: 'networkidle0' });
    log.page_status = res.status();
    if (res.status() === 200) {
      const [user, password] = credentials(target);
      await page.type('input[name=username], #username', user, { delay: 40 });
      await page.type('input[type=password]', password, { delay: 40 });
      await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login'), { timeout: 15000 }).catch(() => null),
        page.click('button[type=submit]')]);
      await settle(log);
    }
    emit('puppeteer-stealth', target, run, { page_status: log.page_status, telemetry: log.telemetry,
      login_status: log.login?.status ?? null, login_body: log.login?.body ?? null,
      pow_solved: log.pow_solved, login_attempts: log.login_attempts });
  } finally {
    await browser.close();
  }
}
