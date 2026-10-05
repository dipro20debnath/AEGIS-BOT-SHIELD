import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("STUDY_AUTOCREATE", "0")

from fastapi.testclient import TestClient  # noqa: E402

from aegis_study.app import create_app  # noqa: E402
from aegis_study.config import StudyConfig  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/141.0.0.0 Safari/537.36")
SECRET = "study-test-secret-0123456789"


@pytest.fixture
def app(tmp_path):
    return create_app(StudyConfig(db_path=str(tmp_path / "study.db"), secret_key=SECRET))


@pytest.fixture
def db(app):
    return app.state.study.db


def new_client(app):
    return TestClient(app, headers={"User-Agent": UA})


@pytest.fixture
def client(app):
    return new_client(app)


CONSENT = {"c_read": "1", "c_aggregate": "1", "c_withdraw": "1", "c_age": "1"}


def enrol(client, code, raw=True, lang="en"):
    data = {**CONSENT, "code": code, "lang": lang}
    if raw:
        data["c_raw"] = "1"
    r = client.post("/start", data=data, follow_redirects=False)
    assert r.status_code == 303, r.text
    r = client.post("/survey/pre", data={"device": "laptop", "input": "mouse"}, follow_redirects=False)
    assert r.headers["location"] == "/shop/login"
