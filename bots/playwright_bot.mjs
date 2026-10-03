/**
 * Playwright bots.
 *   --mode stealth : headless Chromium, real Chrome user agent and Accept-Language,
 *                    automation flag hidden; scripted straight mouse moves, fast typing (T3)
 *   --mode human   : headed Chromium (run under xvfb-run), Bezier mouse paths with
 *                    jitter, reading pauses, scrolling, irregular typing rhythm (T4-like)
 *
 *   xvfb-run -a node bots/playwright_bot.mjs --mode human --target http://localhost:8000 --runs 3
 */
import { chromium } from 'playwright';
import { CHROME_UA, credentials, emit, humanPath, parseArgs, rand, recorder, settle, sleep } from './common.mjs';

const { target, runs, mode } = parseArgs();
const human = mode === 'human';

async function moveTo(page, from, to) {
  for (const [x, y] of humanPath(from[0], from[1], to[0], to[1])) {
    await page.mouse.move(x, y);
    await sleep(rand(6, 18));
  }
  return to;
}

async function typeLikeHuman(page, text) {
  for (const ch of text) {
    await page.keyboard.down(ch);
    await sleep(rand(55, 140));          // dwell
    await page.keyboard.up(ch);
    await sleep(rand(80, 260));          // flight
  }
}

for (let run = 0; run < runs; run++) {
  const browser = await chromium.launch({ headless: !human, args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const context = await browser.newContext({
      userAgent: human ? undefined : CHROME_UA, locale: 'en-US', viewport: { width: 1280, height: 860 },
    });
    const page = await context.newPage();
    const log = recorder(page, cb => page.on('response', async r => cb(r.url(), r.status(), await r.json().catch(() => null))));
    const res = await page.goto(target + '/');
    log.page_status = res.status();
    if (res.status() === 200) {
      const [user, password] = credentials(target);
      const userBox = await page.locator('input[name=username], #username').boundingBox();
      const passBox = await page.locator('input[type=password]').boundingBox();
      const button = await page.locator('button[type=submit]').boundingBox();
      const centre = b => [b.x + b.width * rand(0.3, 0.7), b.y + b.height * rand(0.3, 0.7)];
      if (human) {
        let pos = [rand(200, 900), rand(100, 600)];
        await sleep(rand(800, 1600));                         // reading the page
        await page.mouse.wheel(0, rand(60, 160)); await sleep(rand(300, 700));
        await page.mouse.wheel(0, -rand(60, 160)); await sleep(rand(300, 700));
        pos = await moveTo(page, pos, centre(userBox)); await page.mouse.down(); await sleep(rand(60, 120)); await page.mouse.up();
        await typeLikeHuman(page, user);
        await sleep(rand(300, 800));
        pos = await moveTo(page, pos, centre(passBox)); await page.mouse.down(); await sleep(rand(60, 120)); await page.mouse.up();
        await typeLikeHuman(page, password);
        await sleep(rand(400, 900));
        pos = await moveTo(page, pos, centre(button));
        await page.mouse.down(); await sleep(rand(70, 130));
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login'), { timeout: 15000 }).catch(() => null), page.mouse.up()]);
      } else {
        for (let i = 0; i < 20; i++) await page.mouse.move(100 + i * 12, 200 + i * 3);   // scripted straight line
        await page.fill('input[name=username], #username', user);
        await page.locator('input[type=password]').pressSequentially(password, { delay: 30 });
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login'), { timeout: 15000 }).catch(() => null),
          page.click('button[type=submit]')]);
      }
      await settle(log);
    }
    emit(`playwright-${human ? 'human' : 'stealth'}`, target, run, { page_status: log.page_status, telemetry: log.telemetry,
      login_status: log.login?.status ?? null, login_body: log.login?.body ?? null,
      pow_solved: log.pow_solved, login_attempts: log.login_attempts });
  } finally {
    await browser.close();
  }
}
