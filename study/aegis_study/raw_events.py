"""The raw event types recorded by static/recorder.js (only with the optional consent).

Single source for the server's validation (app.RAW_TYPES), the data dictionary
(docs/thesis/irb/generate_data_dictionary.py) and the tests that check
recorder.js documents the same types.
"""
from typing import Dict, Tuple

#: type -> (fields after the timestamp, meaning)
RAW_EVENTS: Dict[str, Tuple[str, str]] = {
    "m": ("x, y, pointer type, [pressure, contact width, height]", "pointer moved (every coalesced sample)"),
    "d": ("x, y, pointer type, button, element role", "pointer pressed"),
    "u": ("x, y, pointer type, button", "pointer released"),
    "c": ("x, y, element role, element box (left, top, width, height)", "click and the size and place of what was clicked"),
    "w": ("delta x, delta y, delta mode", "mouse wheel"),
    "s": ("scroll x, scroll y", "page scroll position"),
    "k": ("key category, press number, form field name, repeat flag", "key pressed (category only, never which key)"),
    "K": ("key category, press number", "key released"),
    "i": ("input type, form field name", "kind of input event, e.g. typed, pasted, autofilled (never the text)"),
    "p": ("form field name", "paste (never the pasted content)"),
    "f": ("form field name", "form field focused"),
    "b": ("form field name", "form field left"),
    "v": ("visible 0/1", "browser tab shown or hidden"),
    "r": ("viewport width, height, pixel ratio, screen width, height", "window size (at start and on resize)"),
    "n": ("page width, height", "page loaded"),
    "e": ("–", "page left"),
}

#: Key categories: what is recorded instead of the key
KEY_CATEGORIES = {
    "c": "character key (which one is not recorded)", "s": "space", "b": "Backspace", "d": "Delete",
    "e": "Enter", "t": "Tab", "h": "Shift", "m": "Ctrl/Alt/Meta/CapsLock", "a": "arrow or navigation key",
    "i": "input-method composition (e.g. Bangla keyboards)", "o": "other",
}
