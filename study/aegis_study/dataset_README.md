# AEGIS study dataset

Exported by `python -m aegis_study export`. The field-by-field list of what was
collected and why is in `docs/thesis/irb/data_dictionary.md` of the AEGIS
BOT SHIELD repository. `manifest.json` has row counts, consent versions and a
SHA-256 for every file.

## Units of analysis

- **Participant** (`participant`): a salted hash of the study code. One
  person, or one bot configuration. **Use it as the group in
  cross-validation** (e.g. scikit-learn `GroupKFold`). Sessions and pages of
  the same person are strongly correlated, so a random row split overstates
  accuracy.
- **Session** (`session_id`): one pass through the study. A code can have
  several sessions (`session_no`), e.g. one on a computer and one on a phone.
- **Page view**: one page load. The SDK's telemetry `stream` and the raw
  events' `page_view` are the same id, so live telemetry and raw events join
  exactly on it.

## Labels

`label` is `human` (study code `H-…`, given to a consenting participant) or
`bot` (code `B-…`, used by the researcher's bot scripts; `bot_tool` and
`bot_config` say which). Possible label noise on the human side shows in
`post_autofill`, `post_tools`, `post_assistive` and `post_interrupted`. Report
results with and without those sessions.

AEGIS ran in **monitor** mode: nobody was blocked or challenged. Each row
shows the score and the verdict AEGIS *would* have given (block ≥ 80,
challenge ≥ 50).

## Files

### sessions.csv (one row per session)

| Column | Meaning |
|---|---|
| session_id, participant, label, bot_tool, bot_config | identity and ground truth |
| session_no | 1 = first session with this code |
| lang | `bn` or `en` |
| consent_version, raw_consent | which information sheet was agreed to; 1 = raw timings recorded |
| status, duration_s | `completed` when the final survey was submitted; time from consent to then |
| ua_family, ua_major, os_family, mobile | coarse browser and OS (the user agent itself is not stored) |
| pre_age, pre_device, pre_input, pre_usage, pre_typing, pre_hand | survey before the tasks (empty or `no_answer` = not answered) |
| post_autofill, post_tools, post_assistive, post_interrupted, post_difficulty | survey after the tasks |
| `<task>_outcome` | `done`, `skipped` or `open` (not reached) for login, search, compare, cart, checkout, review |
| `<task>_seconds` | time from the task's start to its completion or skip |
| tasks_completed | number of tasks done (0–6) |

### telemetry.csv (one row per AEGIS telemetry report)

The SDK reports 3 s after a page loads, then every 15 s while the page is
visible, and once more when the page is left. The reports of one page view
(`stream`) are **cumulative**. The last one (`is_final` = 1) covers the whole
page view; the earlier ones show what was known at time `t_s`.

| Column | Meaning |
|---|---|
| telemetry_id, session_id, participant, label, bot_tool | identity and ground truth |
| page, task | page route the report came from; task active at that moment |
| stream, t_s, is_final | page view id; seconds since session start; last report of the page view |
| rule_score, ml_probability, score, verdict | live AEGIS scores (model trained on synthetic data) |
| signals, headless_checks, anti_detect | JSON: rule signals with values; failed headless checks; anti-detect result |
| 50 feature columns | `contracts/features.json` (mouse, keyboard, scroll, touch, fingerprint, session, network) |

### tasks.csv

Task events with `t_s` (seconds since session start): `start`, `attempt`
(an unsuccessful try), `complete`, `skip`. `detail` holds JSON, never typed
text. Examples:
- `search` attempts: `matched` (whether the query matched the task) and `results`;
- `checkout` attempts: one true/false per form field;
- `review` events: `chars` (length) and `rating`.

### requests.csv / unlabelled_requests.csv

One row per HTTP request.

| Column | Meaning |
|---|---|
| method, route, status, duration_ms | route without ids or query, e.g. `/shop/product/{id}` |
| aegis_action, aegis_score, aegis_reason | AEGIS request-level decision (monitor mode) |
| header_names | JSON: header names in received order (no values) |
| header_flags | JSON: client hints present, fetch metadata, Accept kind, Accept-Language count, … |

`unlabelled_requests.csv` holds requests that were not part of any study
session: unknown visitors and scanners that found the public site. They are
real but unlabelled. Do not mix them into the labelled evaluation.

### raw/<session_id>.jsonl.gz (participants with raw_consent = 1, and bots)

One JSON object per line, one line per batch (sent every 5 s and when the
page is left):

```json
{"page_view": "…", "page": "/shop/login", "task": "login", "seq": 0, "time_origin": 1791000000000.0,
 "received_t_s": 12.3, "events": [["m", 532.1, 640.0, 212.5, 0], ["k", 901.4, "c", 1, "username", 0], …]}
```

Every event is `[type, t, …]`. `t` is milliseconds since the page's
`time_origin` (epoch ms, so `time_origin + t` is wall-clock time).

| Type | Fields after t | Meaning |
|---|---|---|
| `m` | x, y, pointerType, [pressure, width, height] | pointer moved (all coalesced samples; touch/pen add contact data) |
| `d` / `u` | x, y, pointerType, button, [target] | pointer down / up |
| `c` | x, y, target, left, top, width, height | click and the clicked element's box (for Fitts' law and precision) |
| `w` | deltaX, deltaY, deltaMode | wheel |
| `s` | scrollX, scrollY | scroll position |
| `k` | category, press, field, repeat | key down |
| `K` | category, press | key up; `press` pairs it with its key down |
| `i` | inputType, field | input event type, e.g. `insertText`, `insertFromPaste`, `insertReplacementText` (autofill) |
| `p` | field | paste |
| `f` / `b` | field | focus / blur of a form field |
| `v` | visible | tab became visible (1) or hidden (0) |
| `r` | innerWidth, innerHeight, devicePixelRatio, screenWidth, screenHeight | viewport (at start and on resize) |
| `n` | pageWidth, pageHeight | page start |
| `e` | – | page end |

- **pointerType:** 0 mouse, 1 pen, 2 touch.
- **Key category:** `c` character, `s` space, `b` Backspace, `d` Delete, `e` Enter, `t` Tab, `h` Shift, `m` other modifier,
  `a` arrow/navigation, `i` IME composition (e.g. Bangla input), `o` other.
- **Not recorded:** which key was pressed and what was typed.
- **field:** the form field's name, e.g. `username` or `note`.
- **target:** the element's role, e.g. `button:add-to-cart`.

**Recomputing features:** `node study/tools/replay_features.mjs <dataset>
[--at 5,10,30]` recomputes the mouse, keyboard, scroll and touch features
from these events with the SDK's own code:
- one row per page view;
- with `--at`, also the features after the first 5, 10 and 30 seconds.

Keyboard and scroll features match the live ones. Mouse features use all
coalesced pointer samples, so they are computed at a higher sampling rate
than the live SDK's.

## Known limitations

- Participants were recruited by invitation (students and acquaintances); not a random sample of web users.
- Task copy typing uses text shown on screen. Free typing is limited to the delivery note and the review.
- The bot sessions represent the tools and settings listed in `bot_config`, not all bots.
- Clock: `t_s` uses the server clock. Raw `t` uses the browser's monotonic clock per page.
