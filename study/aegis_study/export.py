"""Dataset export: analysis-ready tables plus the raw event streams.

    python -m aegis_study export --out dataset/

Writes (CSV always, Parquet too when pandas and pyarrow are installed):

  sessions.csv       one row per session: label, participant, device, survey, task outcomes
  telemetry.csv      one row per AEGIS telemetry report: 50 features, live scores, is_final
  tasks.csv          task events (start, attempt, complete, skip) with times
  requests.csv       request metadata of study sessions (header shape, AEGIS request score)
  unlabelled_requests.csv   requests outside any study session (unknown visitors)
  raw/<session>.jsonl.gz    raw event batches (participants who opted in)
  manifest.json      counts, schema version, SHA-256 of every file
  README.md          column descriptions

`participant` is a salted hash of the study code, so the exported dataset
cannot be joined with the researcher's code list. Use it as the group in
cross-validation: all sessions of one person (or one bot configuration)
must stay in the same fold.
"""
import csv
import gzip
import hashlib
import json
import os
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional

from . import i18n, tasks
from .db import Database

SCHEMA_VERSION = 1
FEATURES_JSON = os.path.join(os.path.dirname(__file__), "..", "..", "contracts", "features.json")


def feature_names() -> List[str]:
    path = os.getenv("STUDY_FEATURES_JSON") or FEATURES_JSON
    with open(path, encoding="utf-8") as f:
        contract = json.load(f)
    # {"categories": {"mouse": {"features": [[name, unit, meaning], ...]}, ...}}
    return [feat[0] for spec in contract["categories"].values() for feat in spec["features"]]


def participant_id(code: str, secret: str) -> str:
    return hashlib.sha256(f"{secret}:{code}".encode()).hexdigest()[:12]


def _write_csv(path: str, rows: List[Dict[str, Any]], columns: Optional[List[str]] = None) -> int:
    columns = columns or (list(rows[0].keys()) if rows else [])
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _cell(row.get(k)) for k in columns})
    return len(rows)


def _cell(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    return value


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export(db: Database, out_dir: str, secret: str, parquet: bool = True) -> Dict[str, Any]:
    os.makedirs(os.path.join(out_dir, "raw"), exist_ok=True)
    codes = {r["code"]: r for r in db.rows("codes")}
    sessions = list(db.rows("sessions", "ORDER BY started"))
    survey = defaultdict(dict)
    for r in db.rows("survey"):
        survey[r["session_id"]][r["phase"]] = json.loads(r["answers"])
    events = defaultdict(list)
    for r in db.rows("task_events", "ORDER BY id"):
        events[r["session_id"]].append(r)

    meta: Dict[str, Dict[str, Any]] = {}
    session_rows, task_rows = [], []
    for s in sessions:
        code = codes.get(s["code"])
        label = code["kind"] if code else "unknown"
        pid = participant_id(s["code"], secret)
        meta[s["id"]] = {"participant": pid, "label": label, "started": s["started"],
                         "bot_tool": code["bot_tool"] if code else None}
        row: Dict[str, Any] = {
            "session_id": s["id"], "participant": pid, "label": label,
            "bot_tool": code["bot_tool"] if code else None,
            "bot_config": json.loads(code["bot_config"]) if code and code["bot_config"] else None,
            "session_no": s["session_no"], "lang": s["lang"], "consent_version": s["consent_version"],
            "ui_version": json.loads(s["params"]).get("ui_version"),
            "raw_consent": s["raw_consent"], "status": s["status"],
            "duration_s": round(s["finished"] - s["started"], 1) if s["finished"] else None,
            "ua_family": s["ua_family"], "ua_major": s["ua_major"], "os_family": s["os_family"],
            "mobile": s["mobile"],
        }
        for phase, questions in i18n.SURVEY.items():
            answers = survey[s["id"]].get(phase, {})
            for key, _, _ in questions:
                row[f"{phase}_{key}"] = answers.get(key)
        state = tasks.progress(events[s["id"]])
        starts = {}
        for e in events[s["id"]]:
            if e["event"] == "start":
                starts.setdefault(e["task"], e["at"])
            if e["event"] in ("complete", "skip") and e["task"] in starts and f"{e['task']}_seconds" not in row:
                row[f"{e['task']}_seconds"] = round(e["at"] - starts[e["task"]], 1)
            task_rows.append({"session_id": s["id"], "participant": pid, "label": label, "task": e["task"],
                              "event": e["event"], "t_s": round(e["at"] - s["started"], 3),
                              "detail": json.loads(e["detail"]) if e["detail"] else None})
        for name in tasks.TASKS:
            row[f"{name}_outcome"] = state[name]
            row.setdefault(f"{name}_seconds", None)
        row["tasks_completed"] = sum(1 for v in state.values() if v == "done")
        session_rows.append(row)

    files: Dict[str, int] = {}
    files["sessions.csv"] = _write_csv(os.path.join(out_dir, "sessions.csv"), session_rows)
    files["tasks.csv"] = _write_csv(os.path.join(out_dir, "tasks.csv"), task_rows,
                                    ["session_id", "participant", "label", "task", "event", "t_s", "detail"])

    # -- telemetry: one row per report, flattened features ------------------------------------
    names = feature_names()
    telemetry_rows, last_per_stream = [], {}
    for r in db.rows("telemetry", "WHERE session_id IS NOT NULL ORDER BY id"):
        m = meta.get(r["session_id"])
        if m is None:
            continue
        grouped = json.loads(r["features"])
        flat = {k: v for group in grouped.values() for k, v in group.items()}
        row = {"telemetry_id": r["id"], "session_id": r["session_id"], "participant": m["participant"],
               "label": m["label"], "bot_tool": m["bot_tool"], "page": r["page"], "task": r["task"],
               "stream": r["stream"], "t_s": round(r["received"] - m["started"], 3),
               "rule_score": r["rule_score"], "ml_probability": r["ml_probability"], "score": r["score"],
               "verdict": r["verdict"], "signals": json.loads(r["signals"] or "[]"),
               "headless_checks": json.loads(r["headless_checks"] or "[]"),
               "anti_detect": json.loads(r["anti_detect"]) if r["anti_detect"] else None}
        row.update({n: flat.get(n) for n in names})
        last_per_stream[(r["session_id"], r["stream"])] = len(telemetry_rows)
        telemetry_rows.append(row)
    for row in telemetry_rows:
        row["is_final"] = 0
    for index in last_per_stream.values():
        telemetry_rows[index]["is_final"] = 1
    telemetry_columns = ["telemetry_id", "session_id", "participant", "label", "bot_tool", "page", "task",
                         "stream", "t_s", "is_final", "rule_score", "ml_probability", "score", "verdict",
                         "signals", "headless_checks", "anti_detect"] + names
    files["telemetry.csv"] = _write_csv(os.path.join(out_dir, "telemetry.csv"), telemetry_rows, telemetry_columns)

    # -- requests -------------------------------------------------------------------------------
    request_columns = ["session_id", "participant", "label", "t_s", "method", "route", "status", "duration_ms",
                       "aegis_action", "aegis_score", "aegis_reason", "ua_family", "ua_major", "os_family",
                       "header_names", "header_flags"]
    labelled, unlabelled = [], []
    for r in db.rows("requests", "ORDER BY id"):
        row = dict(r)
        row["header_names"] = json.loads(r["header_names"] or "[]")
        row["header_flags"] = json.loads(r["header_flags"] or "{}")
        m = meta.get(r["session_id"]) if r["session_id"] else None
        if m is None:
            row.update({"session_id": None, "participant": None, "label": "unlabelled", "t_s": None})
            row["at"] = round(r["at"], 3)
            unlabelled.append(row)
        else:
            row.update({"participant": m["participant"], "label": m["label"], "t_s": round(r["at"] - m["started"], 3)})
            labelled.append(row)
    files["requests.csv"] = _write_csv(os.path.join(out_dir, "requests.csv"), labelled, request_columns)
    files["unlabelled_requests.csv"] = _write_csv(os.path.join(out_dir, "unlabelled_requests.csv"), unlabelled,
                                                  ["at"] + request_columns[4:])

    # -- raw events -----------------------------------------------------------------------------
    raw_sessions, raw_events = 0, 0
    by_session = defaultdict(list)
    for r in db.rows("raw_batches", "ORDER BY session_id, page_view, seq"):
        by_session[r["session_id"]].append(r)
    for session_id, batches in by_session.items():
        if session_id not in meta:
            continue
        raw_sessions += 1
        with gzip.open(os.path.join(out_dir, "raw", f"{session_id}.jsonl.gz"), "wt", encoding="utf-8") as f:
            for b in batches:
                data = json.loads(gzip.decompress(b["data"]))
                raw_events += len(data)
                f.write(json.dumps({"page_view": b["page_view"], "page": b["page"], "task": b["task"],
                                    "seq": b["seq"], "time_origin": b["time_origin"],
                                    "received_t_s": round(b["received"] - meta[session_id]["started"], 3),
                                    "events": data}, separators=(",", ":")) + "\n")

    if parquet:
        _parquet(out_dir, ["sessions", "telemetry", "tasks", "requests"])

    with open(os.path.join(os.path.dirname(__file__), "dataset_README.md"), encoding="utf-8") as f:
        readme = f.read()
    with open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)

    checksums = {}
    for root, _, filenames in os.walk(out_dir):
        for name in sorted(filenames):
            if name == "manifest.json":
                continue
            path = os.path.join(root, name)
            checksums[os.path.relpath(path, out_dir)] = _sha256(path)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": files,
        "raw": {"sessions": raw_sessions, "events": raw_events},
        "labels": {k: sum(1 for s in session_rows if s["label"] == k) for k in ("human", "bot")},
        "consent_versions": sorted({s["consent_version"] for s in session_rows}),
        "sha256": checksums,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest


def _parquet(out_dir: str, tables: List[str]) -> None:
    try:
        import pandas as pd  # noqa: F401
        import pyarrow  # noqa: F401
    except ImportError:
        return
    import pandas as pd
    for name in tables:
        frame = pd.read_csv(os.path.join(out_dir, f"{name}.csv"))
        frame.to_parquet(os.path.join(out_dir, f"{name}.parquet"), index=False)
