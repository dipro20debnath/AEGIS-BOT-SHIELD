"""
T2 bot with Selenium + ChromeDriver: headless Chrome with default settings,
types the credentials and submits the form (the page's SDK runs normally).

    python bots/selenium_bot.py --target http://localhost:8000 --runs 3
    env: CHROME_BINARY (Chromium/Chrome), CHROMEDRIVER (matching driver)
"""
import json
import os
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from common import args, credentials, emit

LOGGER = """
window.__aegis = [];
const of = window.fetch;
window.fetch = async (...a) => { const r = await of(...a); const c = r.clone();
  c.text().then(t => window.__aegis.push({url: String(a[0] && a[0].url || a[0]), status: r.status, body: t})); return r; };
"""


def run(target: str, n: int) -> None:
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1280,900")
    if os.getenv("CHROME_BINARY"):
        options.binary_location = os.environ["CHROME_BINARY"]
    service = Service(os.environ["CHROMEDRIVER"]) if os.getenv("CHROMEDRIVER") else Service()
    driver = webdriver.Chrome(options=options, service=service)
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": LOGGER})
        driver.get(target + "/")
        source = driver.find_element(By.TAG_NAME, "body").text
        if source.lstrip().startswith('{"aegis"'):
            # The page itself was denied (403 JSON instead of the login form)
            emit("selenium", target, n, page_status=403, page_body=json.loads(source), telemetry=[],
                 login_status=None, login_body=None)
            return
        user, password = credentials(target)
        wait = WebDriverWait(driver, 10)
        name = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[name=username], #username")))
        name.send_keys(user)
        driver.find_element(By.CSS_SELECTOR, "input[type=password]").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
        deadline = time.time() + 15
        log = []
        while time.time() < deadline:
            log = driver.execute_script("return window.__aegis") or []
            if any("/api/login" in e["url"] for e in log):
                break
            time.sleep(0.2)
        telemetry = [{"status": e["status"], **{k: v for k, v in json.loads(e["body"] or "{}").items() if k in ("score", "verdict")}}
                     for e in log if "/aegis/telemetry" in e["url"]]
        login = next((e for e in log if "/api/login" in e["url"]), None)
        emit("selenium", target, n, page_status=None, telemetry=telemetry,
             login_status=login["status"] if login else None,
             login_body=json.loads(login["body"]) if login and login["body"].startswith("{") else (login or {}).get("body"))
    finally:
        driver.quit()


if __name__ == "__main__":
    a = args()
    for i in range(a.runs):
        run(a.target.rstrip("/"), i)
