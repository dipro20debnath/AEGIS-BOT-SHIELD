"""Study site: consent gating, privacy guarantees, task logic, export and withdrawal."""
import csv
import gzip
import json
import sqlite3

from conftest import CONSENT, SECRET, UA, enrol, new_client

from aegis_study import i18n, tasks
from aegis_study import app as app_module
from aegis_study.__main__ import main as cli
from aegis_study.export import export, participant_id
from aegis_study.util import header_shape, parse_user_agent, route_of, sign, unsign

TELEMETRY = {"v": 1, "siteKey": "aegis-study", "streamId": "view-1", "timestamp": 1,
             "features": {k: {} for k in ("mouse", "keyboard", "scroll", "touch", "fingerprint")}}


def params_of(db):
    return json.loads(list(db.rows("sessions", "ORDER BY started DESC"))[0]["params"])


def complete_all(client, db, note="Please ring the bell twice.", review="Sturdy and quiet, worth the money."):
    p = params_of(db)
    client.post("/shop/login", data={"username": p["username"], "password": p["password"]})
    client.get("/shop/search", params={"q": p["search_term"]})
    client.get(f"/shop/product/{p['search_product']}")
    client.post("/shop/cart/add", data={"product_id": p["compare_target"]})
    client.post("/shop/cart/update", data={"product_id": p["compare_target"], "quantity": p["quantity"]})
    client.post("/shop/cart/remove", data={"product_id": p["decoy_product"]})
    client.post("/shop/checkout", data={**p["delivery"], "note": note})
    client.post(f"/shop/review/{p['compare_target']}", data={"text": review, "rating": "5"})
    return p


# -- consent and entry ------------------------------------------------------------------

def test_nothing_is_recorded_before_consent(client, db):
    code = db.create_codes("human", 1)[0]
    page = client.get("/consent?lang=en").text
    assert "aegis.min.js" not in page and "recorder.js" not in page  # no behaviour scripts before consent
    missing_box = {k: v for k, v in CONSENT.items() if k != "c_age"}
    r = client.post("/start", data={**missing_box, "code": code, "lang": "en"})
    assert r.status_code == 400 and i18n.t("en", "consent_missing") in r.text
    assert list(db.rows("sessions")) == []


def test_invalid_codes_are_rejected_and_rate_limited(client, db):
    for _ in range(10):
        assert client.post("/start", data={**CONSENT, "code": "H-NOTACODE", "lang": "en"}).status_code == 400
    code = db.create_codes("human", 1)[0]
    assert client.post("/start", data={**CONSENT, "code": code, "lang": "en"}).status_code == 429


def test_code_is_normalised_and_sessions_are_numbered(app, db):
    code = db.create_codes("human", 1)[0]
    enrol(new_client(app), "  " + code.lower() + " ")
    enrol(new_client(app), code)
    assert sorted(r["session_no"] for r in db.rows("sessions")) == [1, 2]


def test_tampered_session_cookie_is_not_a_study_session(app, db):
    code = db.create_codes("human", 1)[0]
    client = new_client(app)
    enrol(client, code)
    value = client.cookies.get("study_sid")
    client.cookies.clear()  # replace, not add: httpx would otherwise keep the valid cookie too
    client.cookies.set("study_sid", value[:-1] + ("0" if value[-1] != "0" else "1"))
    assert client.get("/shop", follow_redirects=False).headers["location"] == "/?expired=1"


def test_consent_page_shows_the_irb_information_sheet_only():
    for lang in i18n.LANGS:
        doc = i18n.consent_html(lang)
        assert "<h2>" in doc["html"]
        assert "type=\"checkbox\"" not in doc["html"] and "[ ]" not in doc["html"]
        assert "Participant name" not in doc["html"] and "অংশগ্রহণকারীর নাম" not in doc["html"]


# -- raw events -----------------------------------------------------------------------------

def raw_batch(seq=0, events=None):
    return json.dumps({"pv": "view-1", "s": seq, "o": 1.0, "p": "/shop/login",
                       "e": events or [["m", 1.0, 10, 20, 0], ["k", 2.0, "c", 1, "username", 0]]})


def test_raw_events_need_the_optional_consent(app, db):
    code = db.create_codes("human", 1)[0]
    without = new_client(app)
    enrol(without, code, raw=False)
    assert "recorder.js" not in without.get("/shop/login").text
    assert without.post("/study/raw", content=raw_batch()).status_code == 403
    with_raw = new_client(app)
    enrol(with_raw, code, raw=True)
    assert "recorder.js" in with_raw.get("/shop/login").text
    assert with_raw.post("/study/raw", content=raw_batch()).status_code == 204
    assert db.stats()["raw_events"] == 2


def test_raw_events_are_validated(client, db):
    enrol(client, db.create_codes("human", 1)[0])
    bad = [["m", 1.0, 1, 2, 0], ["x", 1.0], ["k", "t", "c"], ["k", 3.0, "c", 1, "a" * 40, 0], "junk",
           ["m", 4.0, {"nested": 1}]]
    assert client.post("/study/raw", content=raw_batch(events=bad)).status_code == 204
    batch = list(db.rows("raw_batches"))[0]
    assert json.loads(gzip.decompress(batch["data"])) == [["m", 1.0, 1, 2, 0]]
    assert client.post("/study/raw", content="not json").status_code == 400
    assert client.post("/study/raw", content="x" * (600 * 1024)).status_code == 413


# -- tasks ------------------------------------------------------------------------------------

def test_all_tasks_complete_and_telemetry_is_linked(client, db):
    enrol(client, db.create_codes("human", 1)[0])
    r = client.post("/aegis/telemetry", json=TELEMETRY, headers={"Referer": "http://testserver/shop/login"})
    assert r.status_code == 200 and r.json()["token"].startswith("AEGIS.v1.")
    complete_all(client, db)
    session = list(db.rows("sessions"))[0]
    assert tasks.progress(db.task_events(session["id"])) == {t: "done" for t in tasks.TASKS}
    record = list(db.rows("telemetry"))[0]
    assert (record["session_id"], record["page"], record["task"]) == (session["id"], "/shop/login", "login")
    assert record["verdict"] in ("allow", "challenge", "block")


def test_task_bar_shows_progress_and_the_finished_task(client, db):
    enrol(client, db.create_codes("human", 1)[0])
    p = params_of(db)
    page = client.get("/shop/login").text
    assert page.count('class="seg ') == 6 and 'class="seg current"' in page
    assert 'aria-current="step"' in page  # journey step "tasks"
    client.post("/shop/login", data={"username": p["username"], "password": p["password"]})
    page = client.get("/shop").text
    assert 'data-task="search"' in page and 'class="seg done"' in page
    assert 'class="tick"' in page  # the login was finished seconds ago


def test_wrong_answers_are_attempts_and_skip_moves_on(client, db):
    enrol(client, db.create_codes("human", 1)[0])
    p = params_of(db)
    assert client.post("/shop/login", data={"username": p["username"], "password": "wrong"}).status_code == 401
    client.post("/study/skip", data={"task": "login"})
    client.get("/shop/search", params={"q": "nothing like it"})
    events = [(e["task"], e["event"]) for e in db.task_events(list(db.rows("sessions"))[0]["id"])]
    assert ("login", "attempt") in events and ("login", "skip") in events
    assert ("search", "start") in events and ("search", "complete") not in events
    checks = tasks.check_checkout({**p["delivery"], "name": "Someone Else", "note": "x"}, p)
    assert checks["name"] is False and checks["note"] is False and checks["phone"] is True


def test_typed_text_is_never_stored(client, db):
    enrol(client, db.create_codes("human", 1)[0])
    secrets_typed = ["ZebraSearchTerm", "PurpleNoteText", "OrangeReviewText", "WrongPasswordXYZ"]
    p = params_of(db)
    client.post("/shop/login", data={"username": p["username"], "password": secrets_typed[3]})
    client.get("/shop/search", params={"q": secrets_typed[0]})
    complete_all(client, db, note=f"{secrets_typed[1]} after five", review=f"{secrets_typed[2]} is a fine product")
    client.post("/shop/checkout", data={"name": "Typo Name", "note": secrets_typed[1]})  # failed attempt too
    dump = []
    conn = sqlite3.connect(db.path)
    for (table,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        for row in conn.execute(f"SELECT * FROM {table}"):
            for value in row:
                dump.append(gzip.decompress(value).decode() if isinstance(value, bytes) else str(value))
    text = "\n".join(dump)
    # (the dummy credentials the site generated are stored as task targets; they are not typed text)
    for secret in secrets_typed:
        assert secret not in text, secret
    assert UA not in text  # raw user agent is not stored either


# -- export and withdrawal -------------------------------------------------------------------

def test_export_tables_labels_and_groups(app, db, tmp_path):
    human, bot = db.create_codes("human", 1)[0], db.create_codes("bot", 1, "playwright-human", {"speed": 1})[0]
    for code in (human, bot):
        c = new_client(app)
        enrol(c, code)
        c.post("/aegis/telemetry", json={**TELEMETRY, "streamId": code}, headers={"Referer": "http://testserver/shop"})
        c.post("/aegis/telemetry", json={**TELEMETRY, "streamId": code}, headers={"Referer": "http://testserver/shop"})
        c.post("/study/raw", content=raw_batch())
        complete_all(c, db)
    new_client(app).get("/")  # a visitor without a session
    manifest = export(db, str(tmp_path / "out"), SECRET, parquet=False)
    assert manifest["labels"] == {"human": 1, "bot": 1}
    sessions = list(csv.DictReader(open(tmp_path / "out" / "sessions.csv")))
    assert {s["label"] for s in sessions} == {"human", "bot"}
    assert all(s["tasks_completed"] == "6" for s in sessions)
    assert {s["ui_version"] for s in sessions} == {app_module.UI_VERSION}  # layout version of each session
    assert {s["participant"] for s in sessions} == {participant_id(human, SECRET), participant_id(bot, SECRET)}
    assert human not in open(tmp_path / "out" / "sessions.csv").read()  # codes are not exported
    telemetry = list(csv.DictReader(open(tmp_path / "out" / "telemetry.csv")))
    assert len(telemetry) == 4 and sum(int(r["is_final"]) for r in telemetry) == 2
    assert "mouse_avg_velocity" in telemetry[0] and "is_headless" in telemetry[0]
    unlabelled = list(csv.DictReader(open(tmp_path / "out" / "unlabelled_requests.csv")))
    assert unlabelled and "participant" not in unlabelled[0] and "session_id" not in unlabelled[0]
    assert len(list((tmp_path / "out" / "raw").iterdir())) == 2
    assert set(manifest["sha256"]) >= {"sessions.csv", "telemetry.csv", "README.md"}


def test_withdraw_removes_everything_of_one_code(app, db, tmp_path, monkeypatch, capsys):
    keep, remove = db.create_codes("human", 2)
    for code in (keep, remove):
        c = new_client(app)
        enrol(c, code)
        c.post("/study/raw", content=raw_batch())
        c.post("/aegis/telemetry", json=TELEMETRY)
    removed_id = [s["id"] for s in db.rows("sessions") if s["code"] == remove][0]
    monkeypatch.setenv("STUDY_DB", db.path)
    monkeypatch.setenv("AEGIS_SECRET_KEY", SECRET)
    assert cli(["withdraw", remove, "--yes"]) == 0
    assert db.get_code(remove) is None and db.get_code(keep) is not None
    for table in ("sessions", "survey", "task_events", "telemetry", "requests", "raw_batches"):
        column = "id" if table == "sessions" else "session_id"
        assert not list(db.rows(table, f"WHERE {column} = ?", (removed_id,))), table
    assert len(list(db.rows("sessions"))) == 1


def test_cli_codes_and_stats(db, monkeypatch, capsys):
    monkeypatch.setenv("STUDY_DB", db.path)
    assert cli(["codes", "--kind", "bot", "--tool", "selenium", "--count", "3"]) == 0
    codes = capsys.readouterr().out.split()
    assert len(codes) == 3 and all(c.startswith("B-") for c in codes)
    assert cli(["stats"]) == 0
    assert json.loads(capsys.readouterr().out)["codes"] == {"bot": 3}


# -- helpers -----------------------------------------------------------------------------------

def test_user_agent_and_headers_keep_no_raw_values():
    ua = parse_user_agent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/141.0.0.0 Mobile Safari/537.36")
    assert ua == {"ua_family": "Chrome", "ua_major": 141, "os_family": "Android", "mobile": 1}
    assert parse_user_agent("python-requests/2.32")["ua_family"] == "tool"
    names, flags = header_shape([(b"Host", b"x"), (b"Accept", b"*/*"), (b"Cookie", b"secret=1")])
    assert names == ["host", "accept", "cookie"]
    assert flags["accept_kind"] == "any" and "secret" not in json.dumps(flags)
    assert route_of("/shop/product/123?q=x") == "/shop/product/{id}"
    assert unsign(sign("abc", "k" * 16), "k" * 16) == "abc" and unsign("abc.bad", "k" * 16) is None


def test_task_targets_are_valid_for_any_seed():
    for seed in range(200):
        p = tasks.new_params(seed)
        target = tasks.BY_ID[p["compare_target"]]
        cheaper = [q for q in tasks.products_in(p["compare_category"]) if q.rating >= 4.0 and q.price < target.price]
        assert target.rating >= 4.0 and not cheaper
        assert tasks.BY_ID[p["search_product"]] in tasks.search(p["search_term"])
        assert p["decoy_product"] != p["compare_target"]


def test_recorder_documents_exactly_the_accepted_event_types():
    import os
    import re
    from aegis_study.app import RAW_TYPES
    from aegis_study.raw_events import KEY_CATEGORIES, RAW_EVENTS
    source = open(os.path.join(os.path.dirname(__file__), "..", "aegis_study", "static", "recorder.js")).read()
    documented = set(re.findall(r"^ \*   ([a-zA-Z])\b ", source, re.M)) | set(re.findall(r" ([a-zA-Z]) blur", source))
    assert documented == set(RAW_EVENTS) == RAW_TYPES
    written = set(re.findall(r"push\(\['([a-zA-Z])'", source)) | set(re.findall(r"\['([a-zA-Z])', now", source))
    assert written <= RAW_TYPES
    categories = set(re.findall(r"return '([a-z])';", source))
    assert categories == set(KEY_CATEGORIES)


def test_data_dictionary_is_up_to_date():
    import importlib.util
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "thesis", "irb", "generate_data_dictionary.py")
    spec = importlib.util.spec_from_file_location("gen_dd", path)
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    with open(os.path.join(os.path.dirname(path), "data_dictionary.md"), encoding="utf-8") as f:
        assert f.read() == gen.build(), "run python docs/thesis/irb/generate_data_dictionary.py"


def test_consent_checkboxes_match_the_consent_documents():
    import os
    import re
    for lang in i18n.LANGS:
        path = os.path.join(i18n.consent_dir(), f"consent_{lang}.md")
        boxes = [re.sub(r"^\*[^*]+\*\s*", "", line[6:].strip())
                 for line in open(path, encoding="utf-8") if line.startswith("- [ ] ")]
        site = [i18n.t(lang, k) for k in ("consent_read", "consent_aggregate", "consent_withdraw", "consent_age")]
        assert boxes[:4] == site, lang
        assert i18n.t(lang, "consent_raw").startswith(boxes[4]), lang
