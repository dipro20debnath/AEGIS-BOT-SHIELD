"""The study website: consent -> survey -> six shop tasks -> survey -> done.

AEGIS runs in **monitor** mode: every request and telemetry report is scored
and recorded, nobody is ever blocked or challenged, so the tasks are the
same for every participant and the scores show what AEGIS would have done.

Layers, outermost first:
  StudyMiddleware   -> links each request to its study session (signed cookie),
                       logs request metadata, provides context for telemetry records
  AegisFastAPIMiddleware (monitor) -> /aegis/telemetry, request scoring
  routes            -> pages and task logic
"""
import contextvars
import json
import os
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional
from urllib.parse import urlsplit

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from aegis_shield import AegisFastAPIMiddleware, get_config

from . import i18n, tasks
from .raw_events import RAW_EVENTS
from .config import StudyConfig
from .db import Database, normalize_code
from .util import header_shape, parse_user_agent, route_of, sign, unsign

COOKIE = "study_sid"
LANG_COOKIE = "study_lang"
HERE = os.path.dirname(__file__)

_session_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("study_session", default=None)
_page_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("study_page", default=None)
_task_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("study_task", default=None)


class StudyMiddleware:
    """Outermost layer: session context for this request, then one row of request metadata."""

    def __init__(self, app, study: "Study"):
        self.app = app
        self.study = study

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = time.perf_counter()
        headers = scope.get("headers", [])
        cookies = _cookies(headers)
        session_id = unsign(cookies.get(COOKIE), self.study.config.secret_key)
        session = self.study.db.get_session(session_id) if session_id else None
        if session is None:
            session_id = None
        referer = _header(headers, "referer")
        page = route_of(urlsplit(referer).path) if referer else None
        task = tasks.current_task(self.study.db.task_events(session_id)) if session_id else None
        tokens = (_session_var.set(session_id), _page_var.set(page), _task_var.set(task))
        scope.setdefault("state", {})["study_session"] = session

        status = {"code": None}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message.get("status")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            for var, token in zip((_session_var, _page_var, _task_var), tokens):
                var.reset(token)
            if session_id or self.study.config.log_unlabelled:
                self.study.log_request(scope, session_id, status["code"], started, headers)


def _cookies(headers) -> Dict[str, str]:
    raw = _header(headers, "cookie") or ""
    out = {}
    for part in raw.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _header(headers, name: str) -> Optional[str]:
    target = name.encode()
    for k, v in headers:
        if k.lower() == target:
            return v.decode("latin-1")
    return None


class Study:
    def __init__(self, config: StudyConfig):
        config.validate()
        self.config = config
        self.db = Database(config.db_path)
        self._attempts: Dict[str, Deque[float]] = defaultdict(deque)
        #: The shop's only in-memory state: session id -> {product id: quantity}. Run one worker.
        self.cart: Dict[str, Dict[int, int]] = {}

    # -- recording ---------------------------------------------------------------

    def on_telemetry(self, record: Dict[str, Any]) -> None:
        self.db.add_telemetry(_session_var.get(), _page_var.get(), _task_var.get(), record)

    def log_request(self, scope, session_id: Optional[str], status: Optional[int], started: float, headers) -> None:
        aegis = scope.get("state", {}).get("aegis")
        names, flags = header_shape(headers)
        ua = parse_user_agent(_header(headers, "user-agent") or "")
        self.db.add_request({
            "session_id": session_id,
            "at": time.time(),
            "method": scope.get("method", ""),
            "route": route_of(scope.get("path", "")),
            "status": status,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "aegis_action": getattr(aegis, "action", None),
            "aegis_score": getattr(aegis, "score", None),
            "aegis_reason": getattr(aegis, "reason", None),
            "header_names": json.dumps(names),
            "header_flags": json.dumps(flags),
            "ua_family": ua["ua_family"],
            "ua_major": ua["ua_major"],
            "os_family": ua["os_family"],
        })

    # -- code attempts -----------------------------------------------------------

    def allow_attempt(self, client: str) -> bool:
        window = self._attempts[client]
        now = time.time()
        while window and now - window[0] > 600:
            window.popleft()
        return len(window) < self.config.code_attempts

    def failed_attempt(self, client: str) -> None:
        self._attempts[client].append(time.time())

    # -- tasks -------------------------------------------------------------------

    def event(self, session_id: str, task: str, event: str, detail: Optional[Dict[str, Any]] = None) -> None:
        """Record a task event; on complete/skip also mark the start of the next open task."""
        before = tasks.progress(self.db.task_events(session_id))
        if event in ("complete", "skip") and before.get(task) != "open":
            return  # already finished: count each task once
        self.db.task_event(session_id, task, event, detail)
        if event in ("complete", "skip"):
            nxt = tasks.current_task(self.db.task_events(session_id))
            if nxt:
                self.db.task_event(session_id, nxt, "start")


def create_app(config: Optional[StudyConfig] = None) -> FastAPI:
    config = config or StudyConfig.from_env()
    study = Study(config)
    app = FastAPI(title="AEGIS study", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.study = study
    templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))

    aegis_kwargs = get_config()
    aegis_kwargs.update(
        site_key=config.site_key,
        secret_key=config.secret_key,
        mode="monitor",  # record what AEGIS would do; never block or challenge a participant
        secure_cookies=config.secure_cookies,
        excluded_paths=["/health", "/favicon.ico", "/static", "/sdk", "/study/raw"],
        on_record=study.on_telemetry,
    )
    if config.ml_model_path:
        aegis_kwargs["ml_model_path"] = config.ml_model_path
    app.add_middleware(AegisFastAPIMiddleware, **aegis_kwargs)
    app.add_middleware(StudyMiddleware, study=study)  # added last = outermost

    app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")
    if os.path.isdir(config.sdk_dir):
        app.mount("/sdk", StaticFiles(directory=config.sdk_dir), name="sdk")

    # -- helpers ---------------------------------------------------------------------

    def session_of(request: Request):
        return request.scope.get("state", {}).get("study_session")

    def lang_of(request: Request, session=None) -> str:
        if session is not None:
            return session["lang"]
        lang = request.query_params.get("lang") or request.cookies.get(LANG_COOKIE) or "bn"
        return lang if lang in i18n.LANGS else "bn"

    def render(request: Request, name: str, session=None, status: int = 200, **ctx) -> HTMLResponse:
        lang = lang_of(request, session)
        panel = None
        if session is not None and name.startswith("shop"):
            panel = task_panel(session, lang)
        params = json.loads(session["params"]) if session is not None else {}
        logged_in = session is not None and tasks.progress(study.db.task_events(session["id"]))["login"] == "done"
        return templates.TemplateResponse(request, name, {
            "lang": lang,
            "t": lambda key, **v: i18n.t(lang, key, **v),
            "session": session,
            "params": params,
            "panel": panel,
            "raw": bool(session is not None and session["raw_consent"] and config.raw_events_enabled),
            "site_key": config.site_key,
            "categories": tasks.CATEGORIES,
            "cart_count": sum(cart_of(session).values()) if session is not None else 0,
            "logged_in": logged_in,
            **ctx,
        }, status_code=status)

    def task_panel(session, lang: str) -> Dict[str, Any]:
        params = json.loads(session["params"])
        state = tasks.progress(study.db.task_events(session["id"]))
        current = next((tk for tk in tasks.TASKS if state[tk] == "open"), None)
        if current is None:
            return {"current": None, "index": len(tasks.TASKS), "total": len(tasks.TASKS), "text": ""}
        d = params["delivery"]
        values = {
            "username": params["username"], "password": params["password"],
            "search_term": params["search_term"],
            "category": tasks.CATEGORIES[params["compare_category"]],
            "quantity": str(params["quantity"]), "decoy": tasks.BY_ID[params["decoy_product"]].name,
            "name": d["name"], "phone": d["phone"], "address": d["address"], "city": d["city"],
            "postcode": d["postcode"], "option": i18n.t(lang, d["option"]),
            "product": tasks.BY_ID[params["compare_target"]].name,
        }
        return {"current": current, "index": tasks.TASKS.index(current) + 1, "total": len(tasks.TASKS),
                "text": i18n.t(lang, f"t_{current}", **values)}

    def cart_of(session) -> Dict[int, int]:
        raw = study.cart.get(session["id"]) if session is not None else None
        if raw is None and session is not None:
            params = json.loads(session["params"])
            raw = {params["decoy_product"]: 1}  # left in the cart "earlier": the cart task removes it
            study.cart[session["id"]] = raw
        return raw or {}

    def require_session(request: Request):
        session = session_of(request)
        if session is None:
            return None, RedirectResponse("/?expired=1", status_code=303)
        if session["status"] == "completed":
            return session, RedirectResponse("/done", status_code=303)
        return session, None

    def check_cart_task(session) -> None:
        params = json.loads(session["params"])
        cart = cart_of(session)
        if cart.get(params["compare_target"]) == params["quantity"] and params["decoy_product"] not in cart:
            study.event(session["id"], "cart", "complete")

    # -- entry -----------------------------------------------------------------------

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    def landing(request: Request):
        return render(request, "landing.html", expired=bool(request.query_params.get("expired")))

    @app.get("/consent", response_class=HTMLResponse)
    def consent(request: Request):
        lang = lang_of(request)
        response = render(request, "consent.html", doc=i18n.consent_html(lang), error=None,
                          raw_offered=config.raw_events_enabled)
        response.set_cookie(LANG_COOKIE, lang, samesite="lax", secure=config.secure_cookies)
        return response

    @app.post("/start")
    def start(request: Request, code: str = Form(""), lang: str = Form("bn"), c_read: str = Form(""),
              c_aggregate: str = Form(""), c_withdraw: str = Form(""), c_age: str = Form(""),
              c_raw: str = Form("")):
        lang = lang if lang in i18n.LANGS else "bn"
        client = request.client.host if request.client else ""

        def again(error_key: str, status: int):
            return render(request, "consent.html", doc=i18n.consent_html(lang), error=i18n.t(lang, error_key),
                          raw_offered=config.raw_events_enabled, status=status, code=code)

        if not all((c_read, c_aggregate, c_withdraw, c_age)):
            return again("consent_missing", 400)
        if not study.allow_attempt(client):
            return again("too_many", 429)
        code_row = study.db.get_code(normalize_code(code))
        if code_row is None:
            study.failed_attempt(client)
            return again("code_invalid", 400)
        ua = parse_user_agent(request.headers.get("user-agent", ""))
        session_id = study.db.create_session(
            code_row["code"], lang, config.consent_version, bool(c_raw) and config.raw_events_enabled,
            tasks.new_params(), ua)
        response = RedirectResponse("/survey/pre", status_code=303)
        response.set_cookie(COOKIE, sign(session_id, config.secret_key), httponly=True, samesite="lax",
                            secure=config.secure_cookies, max_age=6 * 3600)
        return response

    @app.get("/survey/{phase}", response_class=HTMLResponse)
    def survey(request: Request, phase: str):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if phase not in i18n.SURVEY:
            return Response(status_code=404)
        lang = lang_of(request, session)
        questions = [(key, i18n.t(lang, text), [(o, i18n.option_label(lang, o)) for o in options])
                     for key, text, options in i18n.SURVEY[phase]]
        return render(request, "survey.html", session, phase=phase, questions=questions)

    @app.post("/survey/{phase}")
    async def survey_submit(request: Request, phase: str):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if phase not in i18n.SURVEY:
            return Response(status_code=404)
        form = await request.form()
        allowed = {key: set(options) | {"no_answer"} for key, _, options in i18n.SURVEY[phase]}
        answers = {key: str(form.get(key)) for key in allowed if str(form.get(key)) in allowed[key]}
        study.db.save_survey(session["id"], phase, answers)
        if phase == "pre":
            if not study.db.task_events(session["id"]):
                study.db.task_event(session["id"], tasks.TASKS[0], "start")
            return RedirectResponse("/shop/login", status_code=303)
        study.db.finish_session(session["id"])
        study.cart.pop(session["id"], None)
        return RedirectResponse("/done", status_code=303)

    @app.get("/done", response_class=HTMLResponse)
    def done(request: Request):
        session = session_of(request)
        if session is None:
            return RedirectResponse("/", status_code=303)
        return render(request, "done.html", session, code=session["code"])

    # -- study controls ------------------------------------------------------------------

    @app.post("/study/skip")
    def skip(request: Request, task: str = Form("")):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if task in tasks.TASKS:
            study.event(session["id"], task, "skip")
        return RedirectResponse(request.headers.get("referer") or "/shop", status_code=303)

    @app.get("/study/finish")
    def finish(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        return RedirectResponse("/survey/post", status_code=303)

    @app.post("/study/raw")
    async def raw(request: Request):
        session = session_of(request)
        if session is None or not session["raw_consent"] or not config.raw_events_enabled:
            return Response(status_code=403)
        body = await request.body()
        if len(body) > config.max_raw_batch:
            return Response(status_code=413)
        try:
            batch = json.loads(body)
            events = _valid_events(batch["e"])
            seq = int(batch["s"])
            page_view = str(batch["pv"])[:32]
            origin = float(batch["o"]) if batch.get("o") is not None else None
            page = route_of(str(batch.get("p", ""))[:200])
        except (ValueError, KeyError, TypeError):
            return Response(status_code=400)
        study.db.add_raw_batch(session["id"], page_view, page, _task_var.get(), seq, origin, events)
        return Response(status_code=204)

    # -- shop --------------------------------------------------------------------------------

    @app.get("/shop", response_class=HTMLResponse)
    def shop_home(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        featured = [p for p in tasks.CATALOG if p.id % 5 == 0]
        return render(request, "shop_home.html", session, products=featured, title=None)

    @app.get("/shop/login", response_class=HTMLResponse)
    def login_page(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        return render(request, "shop_login.html", session, error=None)

    @app.post("/shop/login")
    def login(request: Request, username: str = Form(""), password: str = Form("")):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        params = json.loads(session["params"])
        ok = username.strip() == params["username"] and password == params["password"]
        if not ok:
            study.event(session["id"], "login", "attempt", {"ok": False})
            return render(request, "shop_login.html", session, status=401, error=i18n.t(session["lang"], "login_failed"))
        study.event(session["id"], "login", "complete")
        return RedirectResponse("/shop", status_code=303)

    @app.get("/shop/search", response_class=HTMLResponse)
    def search(request: Request, q: str = ""):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        params = json.loads(session["params"])
        results = tasks.search(q)
        target_words = tasks.normalize_words(params["search_term"])
        matched = bool(target_words) and all(w in tasks.normalize_words(q) for w in target_words)
        # Only whether the query matched the task is stored, never the query
        study.event(session["id"], "search", "attempt", {"matched": matched, "results": len(results)})
        return render(request, "shop_list.html", session, products=results, title=i18n.t(session["lang"], "results"),
                      empty=i18n.t(session["lang"], "no_results"))

    @app.get("/shop/category/{name}", response_class=HTMLResponse)
    def category(request: Request, name: str):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if name not in tasks.CATEGORIES:
            return Response(status_code=404)
        return render(request, "shop_list.html", session, products=tasks.products_in(name),
                      title=tasks.CATEGORIES[name], empty="")

    @app.get("/shop/product/{product_id}", response_class=HTMLResponse)
    def product(request: Request, product_id: int):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        item = tasks.BY_ID.get(product_id)
        if item is None:
            return Response(status_code=404)
        params = json.loads(session["params"])
        if product_id == params["search_product"]:
            searched = any(e["task"] == "search" and e["event"] == "attempt" and json.loads(e["detail"] or "{}")
                           .get("matched") for e in study.db.task_events(session["id"]))
            if searched:
                study.event(session["id"], "search", "complete")
        return render(request, "shop_product.html", session, product=item,
                      added=bool(request.query_params.get("added")))

    @app.post("/shop/cart/add")
    def cart_add(request: Request, product_id: int = Form(...)):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if product_id not in tasks.BY_ID:
            return Response(status_code=404)
        cart = cart_of(session)
        cart[product_id] = cart.get(product_id, 0) + 1
        params = json.loads(session["params"])
        correct = product_id == params["compare_target"]
        if tasks.progress(study.db.task_events(session["id"]))["compare"] == "open" and \
                tasks.BY_ID[product_id].category == params["compare_category"]:
            study.event(session["id"], "compare", "complete" if correct else "attempt", {"correct": correct})
        check_cart_task(session)
        return RedirectResponse(f"/shop/product/{product_id}?added=1", status_code=303)

    @app.get("/shop/cart", response_class=HTMLResponse)
    def cart_page(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        items = [(tasks.BY_ID[pid], qty) for pid, qty in cart_of(session).items()]
        total = sum(p.price * q for p, q in items)
        return render(request, "shop_cart.html", session, items=items, total=total)

    @app.post("/shop/cart/update")
    def cart_update(request: Request, product_id: int = Form(...), quantity: int = Form(1)):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        cart = cart_of(session)
        if product_id in cart:
            if quantity <= 0:
                cart.pop(product_id)
            else:
                cart[product_id] = min(quantity, 20)
        check_cart_task(session)
        return RedirectResponse("/shop/cart", status_code=303)

    @app.post("/shop/cart/remove")
    def cart_remove(request: Request, product_id: int = Form(...)):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        cart_of(session).pop(product_id, None)
        check_cart_task(session)
        return RedirectResponse("/shop/cart", status_code=303)

    @app.get("/shop/checkout", response_class=HTMLResponse)
    def checkout_page(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        return render(request, "shop_checkout.html", session, cities=tasks.CITIES, error=None, form={})

    @app.post("/shop/checkout")
    async def checkout(request: Request):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        form = {k: str(v) for k, v in (await request.form()).items()}
        checks = tasks.check_checkout(form, json.loads(session["params"]))
        lang = session["lang"]
        if not all(checks.values()):
            study.event(session["id"], "checkout", "attempt", checks)
            wrong = ", ".join(i18n.t(lang, {"name": "full_name"}.get(k, k)) for k, ok in checks.items() if not ok)
            # Re-show what was typed so the participant can correct it (not stored)
            return render(request, "shop_checkout.html", session, cities=tasks.CITIES, status=400,
                          error=i18n.t(lang, "fix_fields", fields=wrong), form=form)
        study.event(session["id"], "checkout", "complete", {"note_chars": len(form.get("note", "").strip())})
        study.cart[session["id"]] = {}
        return render(request, "shop_message.html", session, message=i18n.t(lang, "order_placed"))

    @app.get("/shop/review/{product_id}", response_class=HTMLResponse)
    def review_page(request: Request, product_id: int):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if product_id not in tasks.BY_ID:
            return Response(status_code=404)
        return render(request, "shop_review.html", session, product=tasks.BY_ID[product_id], error=None)

    @app.post("/shop/review/{product_id}")
    def review(request: Request, product_id: int, text: str = Form(""), rating: str = Form("")):
        session, redirect = require_session(request)
        if redirect is not None:
            return redirect
        if product_id not in tasks.BY_ID:
            return Response(status_code=404)
        correct = product_id == json.loads(session["params"])["compare_target"]
        # Only the length and the rating are kept, never the text
        detail = {"chars": len(text.strip()), "correct": correct}
        if len(text.strip()) < 20 or rating not in ("1", "2", "3", "4", "5"):
            study.event(session["id"], "review", "attempt", detail)
            return render(request, "shop_review.html", session, product=tasks.BY_ID[product_id],
                          status=400, error=i18n.t(session["lang"], "review_short"))
        detail["rating"] = int(rating)
        study.event(session["id"], "review", "complete" if correct else "attempt", detail)
        return render(request, "shop_message.html", session, message=i18n.t(session["lang"], "review_saved"))

    return app


#: Raw event types written by static/recorder.js (see raw_events.py and the data dictionary)
RAW_TYPES = set(RAW_EVENTS)


def _valid_events(events: Any) -> List[List[Any]]:
    """Keep well-formed events only: [type, t_ms, numbers or short labels...]."""
    if not isinstance(events, list) or len(events) > 20000:
        raise ValueError("events")
    out = []
    for e in events:
        if not (isinstance(e, list) and 2 <= len(e) <= 10 and e[0] in RAW_TYPES and isinstance(e[1], (int, float))):
            continue
        if all(isinstance(v, (int, float)) or (isinstance(v, str) and len(v) <= 24) or v is None for v in e[2:]):
            out.append(e)
    return out


app = None
if os.getenv("STUDY_AUTOCREATE", "1") == "1" and os.getenv("AEGIS_SECRET_KEY"):
    # uvicorn aegis_study.app:app
    app = create_app()
