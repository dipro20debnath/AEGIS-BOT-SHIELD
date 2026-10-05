"""
HTTP-only bot for the data-collection study site (study/): goes through the
study with plain requests (no browser, no JavaScript), reading the task panel
from the HTML. Represents scripted bots (T1/T1+).

    python -m aegis_study codes --kind bot --tool requests-forger --count 10 > codes.txt   (in study/)
    python bots/http_study_bot.py --target https://study.example --codes codes.txt --mode forger

--mode naive    library default headers, no telemetry
--mode forger   Chrome-like headers, cookies, one hand-written human-like telemetry report per page
--wait S        seconds to wait on each page (default 0; the "patient" forger uses ~10)

Only run it against the study site you operate.
"""
import argparse
import html
import json
import random
import re
import time

import requests

from common import BROWSER_HEADERS, human_telemetry


def bold_texts(page: str):
    panel = re.search(r'data-study="task-panel" data-task="([a-z]+)"(.*?)</div>\s*</div>', page, re.S)
    if not panel:
        return None, [], ""
    texts = [html.unescape(b) for b in re.findall(r"<b>(.*?)</b>", panel.group(2))]
    return panel.group(1), texts, html.unescape(re.sub(r"<[^>]+>", "", panel.group(2)))


def run(target: str, code: str, mode: str, wait: float, rng: random.Random) -> dict:
    s = requests.Session()
    if mode == "forger":
        s.headers.update(BROWSER_HEADERS)
    result = {"bot": f"requests-{mode}", "code": code, "tasks": {}, "error": None}

    def get(path, **kw):
        r = s.get(target + path, **kw)
        page_done(r)
        return r

    def post(path, data):
        r = s.post(target + path, data=data)
        page_done(r)
        return r

    def page_done(r):
        if mode == "forger" and r.headers.get("content-type", "").startswith("text/html") and "data-site-key" in r.text:
            time.sleep(wait)
            site = re.search(r'data-site-key="([^"]+)"', r.text).group(1)
            payload = human_telemetry(site)
            payload["streamId"] = "%016x" % rng.getrandbits(64)
            s.post(target + "/aegis/telemetry", json=payload, headers={"Referer": r.url})

    try:
        get("/")
        get("/consent?lang=en")
        r = post("/start", {"code": code, "lang": "en", "c_read": "1", "c_aggregate": "1", "c_withdraw": "1",
                            "c_age": "1"})
        r = post("/survey/pre", {})
        page = r.text
        for _ in range(20):
            task, bold, text = bold_texts(page)
            if task in (None, "done"):
                break
            if task == "login":
                page = post("/shop/login", {"username": bold[0], "password": bold[1]}).text
            elif task == "search":
                page = get("/shop/search", params={"q": bold[0]}).text
                href = re.search(r'href="(/shop/product/\d+)" data-study="product-title"', page).group(1)
                page = get(href).text
            elif task == "compare":
                key = {"Phones": "phones", "Laptops": "laptops", "Headphones & Speakers": "audio",
                       "Home & Kitchen": "home", "Books": "books"}[bold[0]]
                page = get(f"/shop/category/{key}").text
                cards = re.findall(r'href="/shop/product/(\d+)" data-study="product-title">.*?৳ ([\d,]+).*?★ ([\d.]+)',
                                   page, re.S)
                best = min((c for c in cards if float(c[2]) >= 4.0), key=lambda c: int(c[1].replace(",", "")))
                page = post("/shop/cart/add", {"product_id": best[0]}).text
            elif task == "cart":
                cart = get("/shop/cart").text
                rows = re.findall(r'<a href="/shop/product/(\d+)">(.*?)</a>', cart)
                decoy = next(pid for pid, name in rows if html.unescape(name) == bold[1])
                keep = next(pid for pid, name in rows if pid != decoy)
                post("/shop/cart/update", {"product_id": keep, "quantity": bold[0]})
                page = post("/shop/cart/remove", {"product_id": decoy}).text
            elif task == "checkout":
                postcode = re.search(r"\b(\d{4})\b", text).group(1)
                page = post("/shop/checkout", {"name": bold[0], "phone": bold[1], "address": bold[2], "city": bold[3],
                                               "postcode": postcode, "option": bold[4].lower(),
                                               "note": "Please deliver in the evening."}).text
            elif task == "review":
                pid = re.search(r'href="/shop/product/(\d+)"', get("/shop/search", params={"q": bold[0]}).text).group(1)
                page = post(f"/shop/review/{pid}", {"text": "Good product for the price, works as described.",
                                                     "rating": str(rng.randint(1, 5))}).text
            after, _, _ = bold_texts(page)
            if after == task:
                page = get("/shop").text
                after, _, _ = bold_texts(page)
            result["tasks"][task] = after != task
            if after == task:
                page = post("/study/skip", {"task": task}).text
        post("/survey/post", {})
        result["finished"] = True
    except Exception as exc:  # report and continue with the next code
        result["error"] = str(exc)[:300]
    return result


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", default="http://localhost:8000")
    p.add_argument("--codes", help="file with one bot study code per line (one code per run)")
    p.add_argument("--code")
    p.add_argument("--mode", choices=["naive", "forger"], default="forger")
    p.add_argument("--wait", type=float, default=0.0)
    p.add_argument("--seed", type=int, default=None)
    a = p.parse_args()
    codes = open(a.codes).read().split() if a.codes else [a.code]
    rng = random.Random(a.seed)
    for code in filter(None, codes):
        print(json.dumps(run(a.target.rstrip("/"), code, a.mode, a.wait, rng)))


if __name__ == "__main__":
    main()
