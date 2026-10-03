import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SITE_KEY = "site-test"
SECRET = "test-secret-key-0123456789abcdef"
CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
BROWSER_HEADERS = {
    "user-agent": CHROME_UA,
    "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="120", "Google Chrome";v="120"',
}


def telemetry_body(human: bool = True, site_key: str = SITE_KEY, **overrides) -> bytes:
    """A telemetry payload shaped like packages/js-sdk buildTelemetry() output."""
    if human:
        mouse = {"mouse_avg_velocity": 420.0, "mouse_velocity_std": 180.0, "mouse_max_velocity": 1500.0,
                 "mouse_avg_acceleration": 30.0, "mouse_acceleration_std": 900.0, "mouse_avg_jerk": 20000.0,
                 "mouse_straightness_index": 0.78, "mouse_curvature_score": 0.2, "mouse_click_precision": 0.7,
                 "mouse_micro_tremor_freq": 9.5, "mouse_fitts_law_r2": 0.8, "mouse_direction_changes": 30,
                 "mouse_pause_count": 12, "mouse_avg_pause_duration": 640, "mouse_event_count": 210}
        keyboard = {"kb_avg_dwell_time": 105, "kb_dwell_time_std": 30, "kb_avg_flight_time": 170,
                    "kb_flight_time_std": 80, "kb_typing_speed": 48, "kb_paste_count": 0, "kb_correction_ratio": 0.06,
                    "kb_cadence_entropy": 4.1, "kb_total_events": 60, "kb_total_duration": 9.5}
        headless = {"is_headless": 0, "headless_confidence": 0.0}
        checks = []
    else:
        mouse = {"mouse_event_count": 0}
        keyboard = {"kb_avg_dwell_time": 2, "kb_cadence_entropy": 0.1, "kb_total_events": 40}
        headless = {"is_headless": 1, "headless_confidence": 0.8}
        checks = ["webdriver"]
    payload = {
        "v": 1, "siteKey": site_key, "streamId": "stream-1", "timestamp": 1,
        "features": {"mouse": mouse, "keyboard": keyboard,
                     "scroll": {"scroll_avg_velocity": 300, "scroll_event_count": 25, "scroll_max_depth": 0.6},
                     "touch": {},
                     "fingerprint": {"has_webgl": 1, "has_canvas": 1, "plugin_count": 5, **headless}},
        "behavioral": {"isHeadless": not human, "timestamp": 1},
        "headlessChecks": checks,
    }
    payload.update(overrides)
    return json.dumps(payload).encode()


@pytest.fixture
def base():
    from aegis_shield.middleware import AegisMiddlewareBase
    return AegisMiddlewareBase(SITE_KEY, SECRET, require_token_paths=["/checkout"])


@pytest.fixture
def human_pace(monkeypatch):
    """A person spends time on the page before the SDK reports: the telemetry is scored
    30 s after the session started (the fixture telemetry claims ~9.5 s of typing)."""
    import time as _time

    import aegis_shield.telemetry as telemetry_module

    class _Clock:
        @staticmethod
        def time():
            return _time.time() + 30

    monkeypatch.setattr(telemetry_module, "time", _Clock)
