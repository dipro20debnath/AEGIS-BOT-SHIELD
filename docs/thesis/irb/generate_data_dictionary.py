"""Regenerate data_dictionary.md from contracts/features.json (run from the repo root)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
contract = json.loads((ROOT / "contracts" / "features.json").read_text())

lines = [
    "# Data Dictionary — AEGIS Bot Detection Study",
    "",
    "_Generated from `contracts/features.json` by `generate_data_dictionary.py`; "
    "the same file defines what the software collects, so this list cannot drift from the code._",
    "",
    "## 1. Per-session behavioural features (stored in the research dataset)",
    "",
    "All values are aggregate numbers computed in the participant's browser or on the server. "
    "No keystroke content, typed text, screen content, URLs visited outside the study site, "
    "or raw pointer coordinates are stored.",
    "",
]
count = 0
for category, spec in contract["categories"].items():
    where = "computed in the browser" if spec["source"] == "sdk" else "computed on the study server"
    lines += [f"### {category.capitalize()} ({where})", "", "| # | Feature | Unit | Meaning |", "|---|---------|------|---------|"]
    for name, unit, meaning in spec["features"]:
        count += 1
        lines.append(f"| {count} | `{name}` | {unit} | {meaning} |")
    lines.append("")

lines += [
    f"Total: {count} features per telemetry report.",
    "",
    "## 2. Other fields in each research record",
    "",
    "| Field | Content | Identifying? |",
    "|-------|---------|--------------|",
    "| `timestamp` | Server time of the report (seconds) | No |",
    "| `session` | Salted SHA-256 hash (16 hex chars) of a random session id | Pseudonymous, unlinkable without the server secret |",
    "| `stream` | Random id generated per page view | No |",
    "| `participant` | Study code (P01, P02, …) entered by the researcher; links to the consent form only via the researcher's key list (added by the data-collection site) | Pseudonymous |",
    "| `label` | `human` (participant session) or bot tool name (researcher-generated traffic) (added by the data-collection site) | No |",
    "| `headless_checks` | Names of automation checks that fired, e.g. `webdriver` | No |",
    "| `rule_score`, `ml_probability`, `score`, `verdict` | Detection outputs | No |",
    "",
    "## 3. Processed but NOT stored",
    "",
    "| Data | Why it is processed | Retention |",
    "|------|--------------------|-----------|",
    "| IP address | Network features (datacenter/Tor flags) and rate limiting | Memory only; never written to the dataset. Server logs: disabled or truncated to /24 |",
    "| User-agent string | Header checks; a 16-char hash binds the token to the browser | Memory only |",
    "| Device fingerprint hash (SHA-256 of canvas/WebGL/audio/screen/browser properties) | Session consistency check | Memory only; not in the research record |",
    "| Session cookie `aegis_sid` | Groups requests of one visit | Expires with the session (30 min inactivity) |",
    "",
    "## 4. Never collected",
    "",
    "- Which keys were pressed or any typed text (passwords in the study are dummy values supplied by the researcher)",
    "- Screenshots, screen recordings, webcam, microphone, location",
    "- Clipboard content (only the number of paste events)",
    "- Browsing history or activity on other sites",
    "",
]
(Path(__file__).parent / "data_dictionary.md").write_text("\n".join(lines))
print(f"wrote data_dictionary.md ({count} features)")
