# Data Dictionary — AEGIS Bot Detection Study

_Generated from `contracts/features.json` by `generate_data_dictionary.py`; the same file defines what the software collects, so this list cannot drift from the code._

## 1. Per-session behavioural features (stored in the research dataset)

All values are aggregate numbers computed in the participant's browser or on the server. No keystroke content, typed text, screen content, URLs visited outside the study site, or raw pointer coordinates are stored.

### Mouse (computed in the browser)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 1 | `mouse_avg_velocity` | px/s | Mean pointer speed within strokes |
| 2 | `mouse_velocity_std` | px/s | Std of pointer speed |
| 3 | `mouse_max_velocity` | px/s | Maximum pointer speed |
| 4 | `mouse_avg_acceleration` | px/s^2 | Mean signed acceleration |
| 5 | `mouse_acceleration_std` | px/s^2 | Std of acceleration |
| 6 | `mouse_avg_jerk` | px/s^3 | Mean absolute jerk |
| 7 | `mouse_straightness_index` | 0-1 | Mean over strokes of direct distance / path length |
| 8 | `mouse_curvature_score` | 0-1 | Mean turning angle between segments / pi |
| 9 | `mouse_click_precision` | 0-1 | 1 = click at target centre, 0 = at its corner or outside |
| 10 | `mouse_micro_tremor_freq` | Hz | Zero-crossing estimate on small movements |
| 11 | `mouse_fitts_law_r2` | 0-1 | R^2 of movement time vs log2(D/W+1) over clicks |
| 12 | `mouse_direction_changes` | count | Sign reversals of x or y velocity |
| 13 | `mouse_pause_count` | count | Gaps > 100 ms between pointer events |
| 14 | `mouse_avg_pause_duration` | ms | Mean length of those gaps |
| 15 | `mouse_event_count` | count | Pointer samples recorded |

### Keyboard (computed in the browser)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 16 | `kb_avg_dwell_time` | ms | Mean key hold time (keydown to its own keyup) |
| 17 | `kb_dwell_time_std` | ms | Std of hold time |
| 18 | `kb_avg_flight_time` | ms | Mean keyup to next keydown (negative under rollover) |
| 19 | `kb_flight_time_std` | ms | Std of flight time |
| 20 | `kb_typing_speed` | WPM | Keystrokes per minute / 5 |
| 21 | `kb_paste_count` | count | Paste events |
| 22 | `kb_correction_ratio` | 0-1 | Backspace/Delete share of keystrokes |
| 23 | `kb_cadence_entropy` | bits | Shannon entropy of flight times in 10 ms bins |
| 24 | `kb_total_events` | count | Keydown + keyup events |
| 25 | `kb_total_duration` | s | First to last keydown |

### Scroll (computed in the browser)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 26 | `scroll_avg_velocity` | px/s | Mean scroll speed between events |
| 27 | `scroll_direction_changes` | count | Up/down reversals |
| 28 | `scroll_max_depth` | 0-1 | Deepest point reached / scrollable height |
| 29 | `scroll_event_count` | count | Scroll events |
| 30 | `scroll_momentum_ratio` | 0-1 | Share of events inside inertial (decaying-speed) runs |

### Touch (computed in the browser)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 31 | `touch_avg_pressure` | 0-1 | Mean reported touch force (0 when unsupported) |
| 32 | `touch_avg_radius` | px | Mean contact radius |
| 33 | `touch_swipe_velocity` | px/s | Mean swipe speed |
| 34 | `touch_tap_count` | count | Touches moving < 10 px |
| 35 | `touch_multi_touch_ratio` | 0-1 | Share of events with > 1 finger |

### Session (computed on the study server)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 36 | `session_duration` | s | First to current request in the session |
| 37 | `session_request_count` | count | Requests in the session |
| 38 | `session_unique_paths` | count | Distinct paths requested |
| 39 | `session_avg_time_between_requests` | s | Mean inter-request gap |
| 40 | `session_reputation` | 0-1 | Risk from session history (0 = clean) |

### Network (computed on the study server)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 41 | `is_vpn` | 0/1 | Known VPN ASN |
| 42 | `is_tor` | 0/1 | Tor exit node |
| 43 | `is_datacenter` | 0/1 | Cloud/hosting IP range |
| 44 | `is_residential_proxy` | 0/1 | Residential proxy indicators |
| 45 | `ip_reputation` | 0-1 | IP risk (0 = clean) |

### Fingerprint (computed in the browser)

| # | Feature | Unit | Meaning |
|---|---------|------|---------|
| 46 | `has_webgl` | 0/1 | WebGL context available |
| 47 | `has_canvas` | 0/1 | 2D canvas available |
| 48 | `plugin_count` | count | navigator.plugins.length |
| 49 | `is_headless` | 0/1 | Headless detector verdict |
| 50 | `headless_confidence` | 0-1 | Headless detector confidence |

Total: 50 features per telemetry report.

## 2. Other fields in each research record

| Field | Content | Identifying? |
|-------|---------|--------------|
| `timestamp` | Server time of the report (seconds) | No |
| `session` | Salted SHA-256 hash (16 hex chars) of a random session id | Pseudonymous, unlinkable without the server secret |
| `stream` | Random id generated per page view | No |
| `participant` | Study code (P01, P02, …) entered by the researcher; links to the consent form only via the researcher's key list (added by the data-collection site) | Pseudonymous |
| `label` | `human` (participant session) or bot tool name (researcher-generated traffic) (added by the data-collection site) | No |
| `headless_checks` | Names of automation checks that fired, e.g. `webdriver` | No |
| `rule_score`, `ml_probability`, `score`, `verdict` | Detection outputs | No |

## 3. Processed but NOT stored

| Data | Why it is processed | Retention |
|------|--------------------|-----------|
| IP address | Network features (datacenter/Tor flags) and rate limiting | Memory only; never written to the dataset. Server logs: disabled or truncated to /24 |
| User-agent string | Header checks; a 16-char hash binds the token to the browser | Memory only |
| Device fingerprint hash (SHA-256 of canvas/WebGL/audio/screen/browser properties) | Session consistency check | Memory only; not in the research record |
| Session cookie `aegis_sid` | Groups requests of one visit | Expires with the session (30 min inactivity) |

## 4. Never collected

- Which keys were pressed or any typed text (passwords in the study are dummy values supplied by the researcher)
- Screenshots, screen recordings, webcam, microphone, location
- Clipboard content (only the number of paste events)
- Browsing history or activity on other sites
