# Pen-test bots

Bot clients for testing AEGIS **against your own deployment** (the demos in
`examples/` or a staging copy of your site). Do not point them at sites you do
not operate. They are also the bot side of the planned data collection
(THESIS_NOTES §0.1): run them against the study site with
`AEGIS_RECORD_FILE` set to collect labelled bot sessions.

| Script | Tier | What it is |
|---|---|---|
| `http_bot.py --mode naive` | T1 | python-requests with library defaults; posts the login directly |
| `http_bot.py --mode forger` | T1+ | Copies Chrome's headers, keeps cookies, sends hand-written human-like telemetry |
| `http_bot.py --mode patient` | T1+ | The forger, waiting 11 s so the claimed interaction time is plausible |
| `scrapy_bot.py` | T1 | Scrapy crawl of a few pages, then the login API |
| `selenium_bot.py` | T2 | Selenium + ChromeDriver, headless Chrome, `send_keys` |
| `puppeteer_stealth_bot.mjs` | T3 | Puppeteer with `puppeteer-extra-plugin-stealth`, headless |
| `playwright_bot.mjs --mode stealth` | T3 | Headless Chromium, Chrome user agent, automation flag hidden, straight mouse lines |
| `playwright_bot.mjs --mode human` | T4-like | Headed Chromium under Xvfb, Bézier mouse paths with jitter, irregular typing, scrolling, pauses |

For the **data-collection study site** (`study/`), `study_bot.mjs` (Playwright or
Puppeteer; modes fast, stealth, human) and `http_study_bot.py` (naive, forger) go
through the full consent, survey and six-task flow with a bot study code. See
[study/README.md](../study/README.md#bot-sessions).

## Setup

```bash
pip install requests scrapy selenium
cd bots && npm install                      # puppeteer-core + stealth plugin (not part of the workspaces)
npx playwright install chromium             # from the repository root, if not installed
# Selenium needs a ChromeDriver matching the browser:
npx @puppeteer/browsers install chromedriver@<chromium version>
export CHROME_BINARY=/path/to/chromium CHROMEDRIVER=/path/to/chromedriver
```

`playwright_bot.mjs --mode human` needs a display: run it under `xvfb-run -a`
on a server.

## Run

Start both demos in **enforce** mode (the Python one with a decision log):

```bash
export AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") AEGIS_MODE=enforce
AEGIS_RECORD_FILE=/tmp/records.jsonl AEGIS_ML_MODEL_PATH=model.pkl uvicorn main:app --app-dir examples/fastapi-integration --port 8000 &
MODEL_PATH=model.pkl uvicorn aegis_ml.server:app --port 8001 &
AEGIS_ML_URL=http://127.0.0.1:8001 AEGIS_REDIS_URL=redis://127.0.0.1:6379/4 PORT=3000 node examples/express-integration/server.js &
```

Then all bots, 5 runs each against both servers:

```bash
python bots/run_pentest.py --runs 5 --label mytest --record-file /tmp/records.jsonl \
  --flush-redis redis://127.0.0.1:6379/4 --before-each "sh restart-targets.sh"
```

- `--before-each` should restart the targets: all bots come from one IP, and
  per-IP state (request velocity) left by one bot would otherwise affect the next.
- `--flush-redis` clears the Node demo's rate-limit windows and sessions.
- Output: `docs/thesis/results/phase_f/pentest_<label>.{md,json}`, with
  pass rates, telemetry scores, how many logins needed a proof of work, and
  the server signals behind each bot's scores.

Each bot can also run alone, e.g. `python bots/http_bot.py --mode forger --target http://localhost:8000 --runs 3`;
it prints one JSON line per run (`passed` = the login returned 200).
