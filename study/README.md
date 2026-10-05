# AEGIS data-collection study site (Phase G)

A small test shop. Volunteers (and the researcher's bots) use it while the
AEGIS SDK and server record behaviour. It produces the labelled human/bot
dataset for the thesis. What is collected, and why, is listed in
[`docs/thesis/irb/data_dictionary.md`](../docs/thesis/irb/data_dictionary.md).
Server setup is in [`deploy/study/README.md`](../deploy/study/README.md).

## Flow for a participant (10–15 min)

1. **Language and consent** (Bangla or English).
   - The information sheet shown is `docs/thesis/irb/consent_<lang>.md`.
   - Four required checkboxes, one **optional** checkbox for raw event timings, and the study code.
   - **Nothing behavioural is recorded before consent:** the SDK and the recorder load only after it.
2. **Short survey** (optional answers): age group, device, pointing device, browser use, keyboard language, hand.
3. **Six tasks in the shop.** A bar at the top always shows the current task, and every task can be skipped.

| # | Task | Behaviour it produces |
|---|---|---|
| 1 | Log in with the dummy username and password shown | copy typing, short fields |
| 2 | Search for a given product and open it | short typing, pointing at a result |
| 3 | Find the cheapest product rated ≥ 4.0 in a category and add it to the cart | reading, scrolling, several pages, decisions |
| 4 | In the cart, set a quantity and remove an item that was already there | small click targets (Fitts' law), number input |
| 5 | Copy delivery details into the checkout form; write a delivery note | long copy typing, select/radio, free typing |
| 6 | Write a short review and give stars | free composition typing, pointing |

   - **Each session has its own random targets** (credentials, product, category, address), so participants do not copy each other.
   - **Completion is checked on the server.** What people type is compared, then discarded: never stored.
4. **Short closing survey:**
   - autofill or password manager used?
   - automation tools?
   - assistive tools?
   - interrupted?
   - how easy?
5. **Thank-you page** showing the study code (needed to withdraw later).

AEGIS runs in **monitor** mode, so nobody is ever blocked or challenged. Every
page view and request gets the score AEGIS *would* have given.

## Why the data is collected this way

| Choice | Reason |
|---|---|
| Fixed tasks on one test site, for people and bots alike | Labels are certain and conditions comparable. Free browsing would make bot and human data differ in *what* they do, not only *how* |
| Mix of copy typing, free typing, pointing, scrolling, reading | Covers every feature group of the model (mouse, keyboard, scroll, touch), including both copy and free typing, which differ in keystroke dynamics |
| Aggregate features **and** raw event timings (opt-in) | Aggregates are what AEGIS uses live. Raw timings let features be recomputed offline with the SDK's own code (fixing extractor bugs, new features, any time window) and let the sequence models of Phase C be tested on real data. Standard keystroke/mouse datasets record raw events (e.g. Killourhy & Maxion 2009, Balabit 2016) |
| No key identities, no typed text, no IP, no raw user agent | Re-identification and privacy risk stay low; content is never needed for timing features |
| Live telemetry snapshots every 15 s, final one on leaving a page | Shows how early a bot can be detected, not only at the end |
| Request metadata (header *names* and order, route, timing) | Network/protocol features for the server-side model, without header values |
| Study codes, invitation only | Unknown visitors (scanners, crawlers on a public server) cannot enter the labelled data; they are kept apart as "unlabelled" |
| One code per participant, several sessions allowed | Within-person repeat sessions (e.g. computer and phone) |
| Survey items on autofill, automation, assistive tools, interruptions | Identify possible label noise and atypical humans, so results can be reported with and without them |
| Same flow for bots, several tools and modes, one code per bot run | Bots differ in tool and skill level (T1–T4). Per-run codes make each bot run its own group in cross-validation |
| `participant` = salted hash of the code in the export | The dataset cannot be joined with the researcher's name list |

**Analysis rule:** split train and test **by participant** (e.g. `GroupKFold`
on the `participant` column). Never split by row: pages of one person are
correlated, and a row split overstates accuracy.

## Running locally

```bash
npm ci && npm run build                                   # builds the SDK bundle
pip install -e packages/ml-engine -e "packages/server-python[fastapi]" jinja2 python-multipart uvicorn
export AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") STUDY_DB=study.db
cd study
python -m aegis_study codes --kind human --count 3
uvicorn aegis_study.app:app --port 8000                   # http://localhost:8000
```

Optional: `AEGIS_ML_MODEL_PATH=model.pkl` for live ML scores, and
`STUDY_RAW_EVENTS=false` to collect aggregates only.

## Researcher commands

| Command | What it does |
|---|---|
| `python -m aegis_study codes --kind human --count 40` | new participant codes (`H-…`) |
| `python -m aegis_study codes --kind bot --tool playwright-human --count 10 --config '{"mode":"human"}'` | bot codes (`B-…`); tool and config go into the dataset |
| `python -m aegis_study stats` | counts so far |
| `python -m aegis_study check` | setup ready? (secret, SDK, model, consent placeholders, HTTPS cookies) |
| `python -m aegis_study export --out dataset/` | dataset with README and checksums (see below) |
| `python -m aegis_study withdraw H-ABCD2345` | deletes every record of that code, then compacts the database file |
| `python -m aegis_study backup --out backup.db` | consistent copy while the site runs |

## Bot sessions

Bots go through the **same** consent, survey and task flow, reading the task
bar like a person. Use one code per run.

```bash
cd study && python -m aegis_study codes --kind bot --tool playwright-human --count 10 --config '{"mode":"human"}' > ../codes-pw-human.txt && cd ..
xvfb-run -a node bots/study_bot.mjs --driver playwright --mode human --target https://STUDY_DOMAIN --codes codes-pw-human.txt
node bots/study_bot.mjs --driver puppeteer --mode stealth --target https://STUDY_DOMAIN --codes codes-pp-stealth.txt
python bots/http_study_bot.py --mode forger --wait 10 --target https://STUDY_DOMAIN --codes codes-requests.txt
```

| Bot | Tier | Notes |
|---|---|---|
| `http_study_bot.py --mode naive` | T1 | requests, library headers, no JavaScript |
| `http_study_bot.py --mode forger [--wait S]` | T1+ | browser headers and hand-written human-like telemetry |
| `study_bot.mjs --mode fast` (playwright or puppeteer) | T2 | element clicks at the centre, instant typing |
| `study_bot.mjs --mode stealth` | T3 | automation flag hidden (Playwright) or stealth plugin (Puppeteer) |
| `study_bot.mjs --mode human` | T4-like | headed browser, Bézier mouse paths, varied click points, reading pauses, wheel scrolling, irregular typing with corrected typos |

Each run prints JSON with its seed and behaviour parameters, so a run can be
reproduced. Aim for roughly as many bot sessions as human sessions, spread
over the tools.

## Dataset

`export` writes `sessions.csv`, `telemetry.csv` (50 features plus live
scores), `tasks.csv`, `requests.csv`, `unlabelled_requests.csv`,
`raw/<session>.jsonl.gz` and `manifest.json`. Parquet copies are added when
pandas and pyarrow are installed. The column-by-column description is
[`aegis_study/dataset_README.md`](aegis_study/dataset_README.md); a copy is
written into every export.

Recompute features from raw events (whole page views, or the first N seconds):

```bash
node study/tools/replay_features.mjs dataset/ --at 5,10,30
```

The end-to-end test (`e2e/study-flow.test.mjs`) checks that the keyboard
features recomputed this way equal the live SDK's values for every page view.
