import json
from pathlib import Path

import pytest

from aegis_shield.middleware import AegisMiddlewareBase
from aegis_shield.telemetry import CONTRACT_KEYS
from aegis_shield.verifier import TokenVerifier
from conftest import BROWSER_HEADERS, SECRET, SITE_KEY, telemetry_body

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "features.json"


def test_contract_keys_match_shared_contract():
    categories = json.loads(CONTRACT.read_text())["categories"]
    sdk = {cat: [f[0] for f in spec["features"]] for cat, spec in categories.items() if spec["source"] == "sdk"}
    assert sdk == CONTRACT_KEYS


def test_human_telemetry_gets_allow_token(base):
    r = base.handle_telemetry(telemetry_body(), "198.51.100.10", BROWSER_HEADERS, {})
    assert r.status == 200
    assert r.body["verdict"] == "allow"
    assert r.body["score"] < 50
    assert r.body["expiresIn"] == 300
    assert "aegis_sid=" in r.headers["Set-Cookie"] and "HttpOnly" in r.headers["Set-Cookie"]
    claims = TokenVerifier(SECRET).verify(r.body["token"])
    assert claims["verdict"] == "allow" and claims["score"] == r.body["score"]


def test_headless_telemetry_is_blocked(base):
    r = base.handle_telemetry(telemetry_body(human=False), "198.51.100.10", BROWSER_HEADERS, {})
    assert r.body["verdict"] == "block"
    assert r.body["score"] >= 80


def test_feature_vector_has_all_50_features(base):
    from aegis_shield.sessions import SessionTracker
    session = base.sessions.get_or_create(None)
    payload = base.telemetry.parse(telemetry_body())
    features = base.telemetry.feature_vector(payload, "159.65.1.1", session)
    assert sum(len(v) for v in features.values()) == 50
    assert features["network"]["is_datacenter"] == 1
    assert set(features["session"]) == {"session_duration", "session_request_count", "session_unique_paths",
                                        "session_avg_time_between_requests", "session_reputation"}


@pytest.mark.parametrize("body,status", [
    (b"not json", 400),
    (json.dumps({"v": 1}).encode(), 400),
    (telemetry_body(site_key="wrong-site"), 403),
    (b"x" * (64 * 1024 + 1), 413),
])
def test_rejects_bad_telemetry(base, body, status):
    assert base.handle_telemetry(body, "1.2.3.4", BROWSER_HEADERS, {}).status == status


def test_drops_unknown_feature_keys(base):
    body = json.loads(telemetry_body())
    body["features"]["mouse"]["injected_key"] = 1e9
    r = base.handle_telemetry(json.dumps(body).encode(), "1.2.3.4", BROWSER_HEADERS, {})
    assert r.status == 200


def test_records_exclude_ip_and_user_agent():
    records = []
    base = AegisMiddlewareBase(SITE_KEY, SECRET, on_record=records.append)
    base.handle_telemetry(telemetry_body(), "198.51.100.77", BROWSER_HEADERS, {})
    assert len(records) == 1
    dumped = json.dumps(records[0], default=str)
    assert "198.51.100.77" not in dumped and "Mozilla" not in dumped
    assert set(records[0]["features"]) == {"mouse", "keyboard", "scroll", "touch", "fingerprint", "session", "network"}


def test_ml_model_contributes_to_score(tmp_path):
    pytest.importorskip("aegis_ml")
    from aegis_ml.features.extractor import FeatureExtractor
    from aegis_ml.models.classifier import BotClassifier
    from aegis_ml.training.synthetic_generator import SyntheticDataGenerator

    data, labels = SyntheticDataGenerator(random_state=0).generate(300, 300)
    clf = BotClassifier()
    clf.train(FeatureExtractor().extract_batch(data), labels)
    model_path = tmp_path / "model.pkl"
    clf.save(str(model_path))

    records = []
    base = AegisMiddlewareBase(SITE_KEY, SECRET, ml_model_path=str(model_path), on_record=records.append)
    assert base.scorer.available
    base.handle_telemetry(telemetry_body(), "198.51.100.10", BROWSER_HEADERS, {})
    base.handle_telemetry(telemetry_body(human=False), "198.51.100.10", BROWSER_HEADERS, {})
    human, bot = records
    assert 0 <= human["ml_probability"] <= 1
    assert bot["ml_probability"] > human["ml_probability"]
    assert any(name == "ml_model" for name, _ in bot["signals"])
