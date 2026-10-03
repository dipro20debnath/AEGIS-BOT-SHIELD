"""
Request-sequence patterns within one session; Python counterpart of
packages/core/src/modules/session/BotBehaviorAnalyzer.ts (same rules and
thresholds). Catches HTTP-library bots that never run the SDK; a bot that
randomises timing, follows links and loads assets passes these checks.
"""
import re
import statistics
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

Signal = Tuple[str, float]

_ASSET_EXT = re.compile(r"\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|map|mp4|webm)$", re.I)
_ASSET_DEST = {"script", "style", "image", "font", "audio", "video", "track", "manifest", "worker"}
_TRAILING_NUMBER = re.compile(r"^(.*?)(\d+)(\D*)$")


@dataclass
class RequestRecord:
    t: float  # seconds
    path: str
    kind: str  # page | asset | api
    has_referer: bool
    status: Optional[int] = None


def classify_request(path: str, method: str = "GET", headers: Optional[Dict[str, str]] = None) -> str:
    h = {k.lower(): v for k, v in (headers or {}).items()}
    dest = h.get("sec-fetch-dest")
    if dest in ("document", "iframe"):
        return "page"
    if dest in _ASSET_DEST:
        return "asset"
    bare = path.split("?")[0]
    if _ASSET_EXT.search(bare):
        return "asset"
    accept = h.get("accept", "")
    if "text/html" in accept:
        return "page"
    if dest == "empty" or "application/json" in accept or bare.startswith("/api/"):
        return "api"
    return "page" if method.upper() == "GET" else "api"


def longest_sequential_run(paths: Sequence[str]) -> int:
    best = run = 1
    prev = None
    step = None
    for p in paths:
        m = _TRAILING_NUMBER.match(p.split("?")[0])
        cur = (f"{m.group(1)}#{m.group(3)}", int(m.group(2))) if m else None
        if cur and prev and cur[0] == prev[0] and cur[1] != prev[1]:
            d = cur[1] - prev[1]
            if step is None or d == step:
                run = 2 if step is None else run + 1
            else:
                run = 2
            step = d
        else:
            run, step = 1, None
        best = max(best, run)
        prev = cur
    return best


def session_signals(history: Sequence[RequestRecord], expect_assets: bool = False) -> List[Signal]:
    """Signals as (name, value x confidence), matching the Node analyzer's signal values."""
    pages = [r for r in history if r.kind == "page"]
    out: List[Signal] = []

    if len(pages) >= 8:
        gaps = [b.t - a.t for a, b in zip(pages, pages[1:])][-20:]
        mean = sum(gaps) / len(gaps)
        cv = statistics.pstdev(gaps) / mean if mean > 0 else 0
        if 0 < mean < 60 and cv < 0.15:
            out.append(("session_timer_regular", 65 * (0.85 if cv < 0.05 else 0.7)))

    run = longest_sequential_run([r.path for r in pages])
    if run >= 5:
        out.append(("session_sequential_ids", 70 * min(0.9, 0.5 + run * 0.05)))

    if len(pages) >= 30:
        span = pages[-1].t - pages[0].t
        unique = len({r.path.split("?")[0] for r in pages})
        if unique / len(pages) > 0.9 and span < 300:
            out.append(("session_crawl_breadth", 50 * 0.6))

    answered = [r for r in history if r.status is not None]
    if len(answered) >= 10:
        errors = sum(1 for r in answered if 400 <= r.status < 500)
        if errors / len(answered) > 0.5:
            out.append(("session_error_probing", 60 * 0.7))

    if len(pages) >= 5 and not any(r.has_referer for r in pages[1:]):
        out.append(("session_no_referer", 40 * 0.5))

    if expect_assets and len(pages) >= 5 and not any(r.kind == "asset" for r in history):
        out.append(("session_no_assets", 55 * 0.6))
    return out
