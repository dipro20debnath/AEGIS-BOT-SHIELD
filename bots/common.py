"""Shared settings for the Python bots: targets, credentials, result format."""
import json
import re
import sys
import time

CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
BROWSER_HEADERS = {
    "User-Agent": CHROME_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

# Demo credentials of examples/ (FastAPI: demo/demo, Express: admin/password)
CREDENTIALS = {"8000": ("demo", "demo"), "3000": ("admin", "password")}


def credentials(target: str):
    port = target.rstrip("/").rsplit(":", 1)[-1]
    return CREDENTIALS.get(port, ("demo", "demo"))


def site_key(html: str) -> str:
    match = re.search(r'data-site-key="([^"]+)"', html) or re.search(r"siteKey:\s*'([^']+)'", html)
    return match.group(1) if match else "demo-site"


def emit(bot: str, target: str, run: int, **result) -> None:
    """One JSON line per run on stdout (read by run_pentest.py)."""
    login = result.get("login_status")
    record = {"bot": bot, "target": target, "run": run, "time": time.time(), **result,
              "passed": login == 200}
    print(json.dumps(record), flush=True)


def human_telemetry(site: str) -> dict:
    """Telemetry with plausible human values, written by hand: what a forger would send."""
    return {
        "v": 1, "siteKey": site, "streamId": f"forged-{int(time.time() * 1000)}", "timestamp": time.time() * 1000,
        "features": {
            "mouse": {"mouse_avg_velocity": 412.0, "mouse_velocity_std": 176.0, "mouse_max_velocity": 1480.0,
                      "mouse_avg_acceleration": 31.0, "mouse_acceleration_std": 880.0, "mouse_avg_jerk": 19500.0,
                      "mouse_straightness_index": 0.76, "mouse_curvature_score": 0.21, "mouse_click_precision": 0.71,
                      "mouse_micro_tremor_freq": 9.1, "mouse_fitts_law_r2": 0.79, "mouse_direction_changes": 28,
                      "mouse_pause_count": 11, "mouse_avg_pause_duration": 620, "mouse_event_count": 205},
            "keyboard": {"kb_avg_dwell_time": 104, "kb_dwell_time_std": 29, "kb_avg_flight_time": 168,
                         "kb_flight_time_std": 78, "kb_typing_speed": 47, "kb_paste_count": 0,
                         "kb_correction_ratio": 0.05, "kb_cadence_entropy": 4.0, "kb_total_events": 58,
                         "kb_total_duration": 9.2},
            "scroll": {}, "touch": {},
            "fingerprint": {"has_webgl": 1, "has_canvas": 1, "plugin_count": 5, "is_headless": 0, "headless_confidence": 0},
        },
        "behavioral": {
            "isHeadless": False,
            "mouse": {"eventCount": 205, "avgVelocity": 412, "velocityStd": 176, "avgAcceleration": 31, "avgJerk": 19500,
                      "straightnessIndex": 0.76, "clickCount": 3, "clickPrecision": 0.71, "microTremorFreq": 9.1,
                      "fittsLawR2": 0.79, "samples": []},
            "keyboard": {"eventCount": 58, "avgDwellTime": 104, "dwellTimeStd": 29, "avgFlightTime": 168, "flightTimeStd": 78,
                         "typingSpeed": 47, "pasteCount": 0, "correctionRatio": 0.05, "cadenceEntropy": 4.0},
        },
        "headlessChecks": [],
        "antiDetect": {"score": 0, "checks": []},
    }


def args():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="http://localhost:8000")
    parser.add_argument("--runs", type=int, default=1)
    return parser.parse_args(sys.argv[1:])
