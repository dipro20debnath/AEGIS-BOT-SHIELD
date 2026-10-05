"""SQLite storage for the study.

One file, WAL mode, one connection guarded by a lock: the study has tens of
participants, so simplicity and durability matter more than concurrency.

What is stored is listed field by field in docs/thesis/irb/data_dictionary.md.
Never stored: IP addresses, the raw user agent, typed text (search terms,
form fields, passwords), key identities.
"""
import gzip
import json
import secrets
import sqlite3
import threading
import time
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

SCHEMA = """
CREATE TABLE IF NOT EXISTS codes (
    code        TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('human', 'bot')),
    bot_tool    TEXT,              -- e.g. playwright-human (bots only)
    bot_config  TEXT,              -- JSON, e.g. speed and jitter settings (bots only)
    created     REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,   -- random, also the study cookie value (signed)
    code            TEXT NOT NULL REFERENCES codes(code),
    session_no      INTEGER NOT NULL,   -- 1 for the first session with this code, 2 for the next ...
    lang            TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    consent_at      REAL NOT NULL,
    raw_consent     INTEGER NOT NULL,   -- 1 = agreed to raw event timings
    started         REAL NOT NULL,
    finished        REAL,
    status          TEXT NOT NULL DEFAULT 'active',  -- active | completed
    params          TEXT NOT NULL,      -- JSON: this session's task targets
    ua_family       TEXT,               -- coarse browser family, e.g. Chrome
    ua_major        INTEGER,
    os_family       TEXT,               -- Windows | macOS | Linux | Android | iOS | ChromeOS | other
    mobile          INTEGER             -- 1 if the browser reported a mobile device
);
CREATE TABLE IF NOT EXISTS survey (
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    phase       TEXT NOT NULL CHECK (phase IN ('pre', 'post')),
    answers     TEXT NOT NULL,          -- JSON of fixed-choice answers
    at          REAL NOT NULL,
    PRIMARY KEY (session_id, phase)
);
CREATE TABLE IF NOT EXISTS task_events (
    id          INTEGER PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    task        TEXT NOT NULL,
    event       TEXT NOT NULL,          -- start | complete | skip | attempt
    at          REAL NOT NULL,
    detail      TEXT                    -- JSON, never typed text
);
CREATE TABLE IF NOT EXISTS telemetry (
    id              INTEGER PRIMARY KEY,
    session_id      TEXT,               -- NULL = not part of a study session
    received        REAL NOT NULL,
    page            TEXT,               -- route the telemetry came from, e.g. /shop/product
    task            TEXT,               -- task active when it was received
    stream          TEXT,               -- SDK stream id (one per page view)
    features        TEXT NOT NULL,      -- JSON: the 50 features (contracts/features.json)
    headless_checks TEXT,
    anti_detect     TEXT,
    rule_score      REAL,
    ml_probability  REAL,
    score           REAL,
    verdict         TEXT,
    signals         TEXT
);
CREATE TABLE IF NOT EXISTS requests (
    id              INTEGER PRIMARY KEY,
    session_id      TEXT,               -- NULL = not part of a study session (unlabelled traffic)
    at              REAL NOT NULL,
    method          TEXT NOT NULL,
    route           TEXT NOT NULL,      -- path pattern without query values, e.g. /shop/product/{id}
    status          INTEGER,
    duration_ms     REAL,
    aegis_action    TEXT,
    aegis_score     REAL,
    aegis_reason    TEXT,
    header_names    TEXT,               -- JSON: header names in received order (no values)
    header_flags    TEXT,               -- JSON: presence/shape of selected headers
    ua_family       TEXT,
    ua_major        INTEGER,
    os_family       TEXT
);
CREATE TABLE IF NOT EXISTS raw_batches (
    id                  INTEGER PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES sessions(id),
    page_view           TEXT NOT NULL,  -- random id per page view (client)
    page                TEXT,
    task                TEXT,
    seq                 INTEGER NOT NULL,
    received            REAL NOT NULL,
    time_origin         REAL,           -- performance.timeOrigin of the page (ms since epoch)
    n_events            INTEGER NOT NULL,
    data                BLOB NOT NULL   -- gzip(JSON)
);
CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_session ON raw_batches(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON task_events(session_id);
"""

#: Study codes: 8 characters from an alphabet without look-alikes (40 bits).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
#: Tables holding per-session data, in deletion order
SESSION_TABLES = ("raw_batches", "telemetry", "requests", "task_events", "survey")


def new_code(kind: str) -> str:
    body = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    return ("H-" if kind == "human" else "B-") + body


def normalize_code(text: str) -> str:
    return "".join(ch for ch in text.upper() if ch.isalnum() or ch == "-").strip("-")


class Database:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _exec(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    def _all(self, sql: str, params: Iterable[Any] = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def _one(self, sql: str, params: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    # -- codes -------------------------------------------------------------

    def create_codes(self, kind: str, count: int, bot_tool: Optional[str] = None,
                     bot_config: Optional[Dict[str, Any]] = None) -> List[str]:
        if kind not in ("human", "bot"):
            raise ValueError("kind must be human or bot")
        if kind == "bot" and not bot_tool:
            raise ValueError("bot codes need a bot tool name")
        codes = []
        while len(codes) < count:
            code = new_code(kind)
            try:
                self._exec("INSERT INTO codes VALUES (?, ?, ?, ?, ?)",
                           (code, kind, bot_tool if kind == "bot" else None,
                            json.dumps(bot_config) if bot_config else None, time.time()))
                codes.append(code)
            except sqlite3.IntegrityError:
                continue  # collision, draw again
        return codes

    def get_code(self, code: str) -> Optional[sqlite3.Row]:
        return self._one("SELECT * FROM codes WHERE code = ?", (code,))

    # -- sessions ----------------------------------------------------------

    def create_session(self, code: str, lang: str, consent_version: str, raw_consent: bool,
                       params: Dict[str, Any], client: Dict[str, Any]) -> str:
        session_id = secrets.token_urlsafe(18)
        now = time.time()
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) FROM sessions WHERE code = ?", (code,)).fetchone()
            self._conn.execute(
                "INSERT INTO sessions (id, code, session_no, lang, consent_version, consent_at, raw_consent,"
                " started, params, ua_family, ua_major, os_family, mobile)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, code, row[0] + 1, lang, consent_version, now, int(raw_consent), now,
                 json.dumps(params), client.get("ua_family"), client.get("ua_major"),
                 client.get("os_family"), client.get("mobile")))
        return session_id

    def get_session(self, session_id: str) -> Optional[sqlite3.Row]:
        return self._one("SELECT * FROM sessions WHERE id = ?", (session_id,))

    def finish_session(self, session_id: str) -> None:
        self._exec("UPDATE sessions SET finished = ?, status = 'completed' WHERE id = ? AND finished IS NULL",
                   (time.time(), session_id))

    # -- survey and tasks --------------------------------------------------

    def save_survey(self, session_id: str, phase: str, answers: Dict[str, str]) -> None:
        self._exec("INSERT OR REPLACE INTO survey VALUES (?, ?, ?, ?)",
                   (session_id, phase, json.dumps(answers, sort_keys=True), time.time()))

    def task_event(self, session_id: str, task: str, event: str, detail: Optional[Dict[str, Any]] = None) -> None:
        self._exec("INSERT INTO task_events (session_id, task, event, at, detail) VALUES (?, ?, ?, ?, ?)",
                   (session_id, task, event, time.time(), json.dumps(detail) if detail else None))

    def task_events(self, session_id: str) -> List[sqlite3.Row]:
        return self._all("SELECT * FROM task_events WHERE session_id = ? ORDER BY id", (session_id,))

    # -- measurements ------------------------------------------------------

    def add_telemetry(self, session_id: Optional[str], page: Optional[str], task: Optional[str],
                      record: Dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO telemetry (session_id, received, page, task, stream, features, headless_checks, anti_detect,"
            " rule_score, ml_probability, score, verdict, signals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, time.time(), page, task, record.get("stream"), json.dumps(record["features"]),
             json.dumps(record.get("headless_checks") or []), json.dumps(record.get("anti_detect")),
             record.get("rule_score"), record.get("ml_probability"), record.get("score"), record.get("verdict"),
             json.dumps(record.get("signals") or [])))

    def add_request(self, row: Dict[str, Any]) -> None:
        columns = ("session_id", "at", "method", "route", "status", "duration_ms", "aegis_action", "aegis_score",
                   "aegis_reason", "header_names", "header_flags", "ua_family", "ua_major", "os_family")
        self._exec(f"INSERT INTO requests ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                   [row.get(c) for c in columns])

    def add_raw_batch(self, session_id: str, page_view: str, page: Optional[str], task: Optional[str], seq: int,
                      time_origin: Optional[float], events: List[Any]) -> None:
        blob = gzip.compress(json.dumps(events, separators=(",", ":")).encode())
        self._exec(
            "INSERT INTO raw_batches (session_id, page_view, page, task, seq, received, time_origin, n_events, data)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, page_view, page, task, seq, time.time(), time_origin, len(events), blob))

    # -- export, withdrawal, statistics --------------------------------------

    def rows(self, table: str, where: str = "", params: Iterable[Any] = ()) -> Iterator[sqlite3.Row]:
        if table not in ("codes", "sessions", "survey", "task_events", "telemetry", "requests", "raw_batches"):
            raise ValueError(table)
        with self._lock:
            cursor = self._conn.execute(f"SELECT * FROM {table} {where}", tuple(params))
            rows = cursor.fetchall()
        yield from rows

    def withdraw(self, code: str) -> Tuple[int, int]:
        """Delete everything recorded under a code (and the code). Returns (sessions, rows) deleted."""
        with self._lock:
            ids = [r[0] for r in self._conn.execute("SELECT id FROM sessions WHERE code = ?", (code,))]
            deleted = 0
            self._conn.execute("BEGIN")
            try:
                for table in SESSION_TABLES:
                    for session_id in ids:
                        deleted += self._conn.execute(f"DELETE FROM {table} WHERE session_id = ?",
                                                      (session_id,)).rowcount
                self._conn.execute("DELETE FROM sessions WHERE code = ?", (code,))
                self._conn.execute("DELETE FROM codes WHERE code = ?", (code,))
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            # Overwrite freed pages so deleted data does not linger in the file
            self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self._conn.execute("VACUUM")
        return len(ids), deleted

    def stats(self) -> Dict[str, Any]:
        def scalar(sql: str) -> Any:
            row = self._one(sql)
            return row[0] if row else None

        return {
            "codes": {r["kind"]: r["n"] for r in self._all("SELECT kind, COUNT(*) AS n FROM codes GROUP BY kind")},
            "sessions": {f"{r['kind']}/{r['status']}": r["n"] for r in self._all(
                "SELECT c.kind, s.status, COUNT(*) AS n FROM sessions s JOIN codes c ON c.code = s.code"
                " GROUP BY c.kind, s.status")},
            "raw_consent_sessions": scalar("SELECT COUNT(*) FROM sessions WHERE raw_consent = 1"),
            "telemetry_records": scalar("SELECT COUNT(*) FROM telemetry WHERE session_id IS NOT NULL"),
            "raw_events": scalar("SELECT COALESCE(SUM(n_events), 0) FROM raw_batches"),
            "requests_labelled": scalar("SELECT COUNT(*) FROM requests WHERE session_id IS NOT NULL"),
            "requests_unlabelled": scalar("SELECT COUNT(*) FROM requests WHERE session_id IS NULL"),
        }

    def backup(self, target: str) -> None:
        """Consistent copy of the database while the site keeps running."""
        dest = sqlite3.connect(target)
        with self._lock:
            self._conn.backup(dest)
        dest.close()
