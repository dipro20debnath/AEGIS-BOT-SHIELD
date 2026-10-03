"""
OpenAPI document of the AEGIS endpoints (contracts/openapi.json, copied into
this package by `npm run sync:openapi`; a test checks the copy is current).

The middleware answers /aegis/telemetry and /aegis/challenge before FastAPI's
router sees them, so FastAPI's generated document does not list them.
add_aegis_openapi(app) merges them in, so /docs shows them next to your routes.
"""
import copy
import json
from functools import lru_cache
from importlib import resources
from typing import Any, Dict

#: Operations answered by the middleware itself (the rest of the document is the Node status API)
MIDDLEWARE_PATHS = ("/aegis/telemetry", "/aegis/challenge")


@lru_cache(maxsize=1)
def _load() -> Dict[str, Any]:
    return json.loads(resources.files("aegis_shield").joinpath("openapi.json").read_text(encoding="utf-8"))


def openapi_spec() -> Dict[str, Any]:
    """The full document (a copy; safe to modify)."""
    return copy.deepcopy(_load())


def add_aegis_openapi(app) -> None:
    """Add the middleware endpoints to a FastAPI app's OpenAPI document (/openapi.json, /docs)."""
    original = app.openapi

    def openapi() -> Dict[str, Any]:
        if app.openapi_schema and app.openapi_schema.get("x-aegis"):
            return app.openapi_schema
        schema = original()
        aegis = _load()
        for path in MIDDLEWARE_PATHS:
            schema.setdefault("paths", {})[path] = copy.deepcopy(aegis["paths"][path])
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for name, definition in aegis["components"]["schemas"].items():
            components.setdefault(name, copy.deepcopy(definition))
        schema["x-aegis"] = True
        app.openapi_schema = schema
        return schema

    app.openapi = openapi
