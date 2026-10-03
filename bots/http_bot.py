"""
T1 bots with python-requests.

  naive : library defaults (python-requests user agent), posts the login directly.
  forger: copies Chrome's request headers, keeps cookies, and sends hand-written
          human-like telemetry before logging in. Tests whether telemetry alone
          can be forged past AEGIS (whitepaper section 4.1).
  patient: the forger, but it waits 11 s between page load and telemetry, so the
          claimed interaction time is plausible (an attacker who knows the timing check).

    python bots/http_bot.py --mode forger --target http://localhost:8000 --runs 3
"""
import sys
import time

import requests

from common import BROWSER_HEADERS, args, credentials, emit, human_telemetry, site_key


def run(mode: str, target: str, n: int) -> None:
    user, password = credentials(target)
    s = requests.Session()
    patient = mode == "patient"
    mode = "forger" if patient else mode
    if mode == "forger":
        s.headers.update(BROWSER_HEADERS)
    page = s.get(target + "/", timeout=10)
    result = {"page_status": page.status_code, "telemetry": []}
    token = None
    if patient:
        time.sleep(11)
    if mode == "forger":
        api = {"Accept": "*/*", "Content-Type": "application/json", "Origin": target, "Referer": target + "/",
               "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"}
        r = s.post(target + "/aegis/telemetry", json=human_telemetry(site_key(page.text)), headers=api, timeout=10)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        result["telemetry"].append({"status": r.status_code, "score": body.get("score"), "verdict": body.get("verdict")})
        token = body.get("token")
    headers = {"Content-Type": "application/json"}
    if mode == "forger":
        headers.update({"Accept": "*/*", "Origin": target, "Referer": target + "/", "Sec-Fetch-Dest": "empty",
                        "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"})
    if token:
        headers["X-Aegis-Token"] = token
    login = s.post(target + "/api/login", json={"username": user, "password": password}, headers=headers, timeout=10)
    try:
        body = login.json()
    except ValueError:
        body = login.text[:200]
    emit("requests-forger-patient" if patient else f"requests-{mode}", target, n, login_status=login.status_code, login_body=body, **result)


if __name__ == "__main__":
    mode = sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else "naive"
    argv = [a for i, a in enumerate(sys.argv) if a != "--mode" and (i == 0 or sys.argv[i - 1] != "--mode")]
    sys.argv = argv
    a = args()
    for i in range(a.runs):
        run(mode, a.target.rstrip("/"), i)
