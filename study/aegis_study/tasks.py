"""The test shop's catalogue and the study tasks.

Each session gets its own random task targets (credentials, search term,
category, delivery details), so participants do not copy each other and
learning effects average out. Completion is checked on the server; what the
participant typed is compared and then discarded, never stored.

Tasks, in order, and the behaviour each one produces:

| Task     | What the participant does                                    | Behaviour |
|----------|--------------------------------------------------------------|-----------|
| login    | types a given username and password                          | copy typing, short fields, Tab/click between fields |
| search   | searches for a given product and opens it                    | short typing, pointing at a result |
| compare  | finds the cheapest well-rated product in a category, adds it | reading, scrolling, several page visits, decisions |
| cart     | sets a quantity and removes an unwanted item                 | small click targets (Fitts' law), number input |
| checkout | copies delivery details into a form, writes a delivery note  | long copy typing, select/radio, free typing |
| review   | writes a short review and picks a star rating                | free composition typing, pointing |
"""
import random
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

TASKS = ["login", "search", "compare", "cart", "checkout", "review"]

CATEGORIES = {
    "phones": "Phones",
    "laptops": "Laptops",
    "audio": "Headphones & Speakers",
    "home": "Home & Kitchen",
    "books": "Books",
}

_NAMES = {
    "phones": ["Nova X5 Smartphone", "Orbit Lite Phone", "Pixelon 8 Pro", "Zenith A3 Phone", "Kite M2 Smartphone",
               "Aurora S10 Phone", "Delta Note 4", "Lumen Mini Phone"],
    "laptops": ["Vertex 14 Laptop", "Swift Air 13", "Titan Pro 16 Laptop", "Nimbus Book 15", "Atlas Go 14",
                "Quanta Slim 13", "Ember X 15 Laptop", "Polar Book 14"],
    "audio": ["Wave Wireless Earbuds", "Pulse Over-Ear Headphones", "Echo Mini Speaker", "Bass Cube Speaker",
              "Calm Noise-Cancelling Headphones", "Beat Sport Earbuds", "Studio Wired Headphones",
              "Party Boom Speaker"],
    "home": ["Steel Electric Kettle", "Aroma Rice Cooker", "Breeze Table Fan", "Chef Non-Stick Pan",
             "Fresh Water Filter", "Glow LED Desk Lamp", "Swift Steam Iron", "Blend Pro Mixer"],
    "books": ["Learning Python the Easy Way", "Stories of the Delta", "Data Science Basics", "The Silent River",
              "Web Security in Practice", "Cooking with Spices", "Machine Learning Notes", "History of Bengal"],
}


@dataclass(frozen=True)
class Product:
    id: int
    category: str
    name: str
    price: int        # BDT
    rating: float     # 1.0 - 5.0
    reviews: int


def _build_catalog() -> List[Product]:
    rng = random.Random(20261005)  # fixed: every session sees the same shop
    base = {"phones": 18000, "laptops": 65000, "audio": 2500, "home": 1800, "books": 450}
    products, pid = [], 101
    for category, names in _NAMES.items():
        for name in names:
            price = int(base[category] * rng.uniform(0.6, 2.2) / 10) * 10 - 1
            products.append(Product(pid, category, name, price, round(rng.uniform(3.0, 4.9), 1),
                                    rng.randint(4, 900)))
            pid += 1
    return products


CATALOG = _build_catalog()
BY_ID = {p.id: p for p in CATALOG}


def products_in(category: str) -> List[Product]:
    # Sorted by name, not by price: finding the cheapest needs reading and comparing
    return sorted((p for p in CATALOG if p.category == category), key=lambda p: p.name)


def search(query: str) -> List[Product]:
    words = normalize_words(query)
    if not words:
        return []
    return [p for p in CATALOG if all(any(w in pw for pw in normalize_words(p.name)) for w in words)]


def normalize_words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def same_text(a: str, b: str) -> bool:
    """Equal ignoring case, punctuation and spacing (what a careful person would type)."""
    return normalize_words(a) == normalize_words(b)


# -- per-session parameters -----------------------------------------------------

_FIRST = ["Rahim", "Karim", "Nusrat", "Farhana", "Tanvir", "Sadia", "Arif", "Mitu", "Rafiq", "Jannat", "Imran", "Tania"]
_LAST = ["Ahmed", "Hossain", "Chowdhury", "Rahman", "Islam", "Begum", "Uddin", "Akter", "Khan", "Das"]
_STREETS = ["Zindabazar Road", "Amberkhana Lane", "Lamabazar Road", "Subid Bazar Lane", "Kumarpara Road",
            "Shahi Eidgah Road", "Uposhohor Block C", "Tilagor Lane"]
CITIES = ["Sylhet", "Dhaka", "Chattogram", "Khulna", "Rajshahi"]
_WORDS = ["blue", "river", "tiger", "maple", "sunny", "rocket", "green", "lotus", "cloud", "mango", "pearl", "storm"]


def new_params(seed: Optional[int] = None) -> Dict[str, Any]:
    rng = random.Random(seed)
    first, last = rng.choice(_FIRST), rng.choice(_LAST)
    search_target = rng.choice(CATALOG)
    compare_category = rng.choice([c for c in CATEGORIES if c != search_target.category])
    candidates = [p for p in products_in(compare_category) if p.rating >= 4.0]
    compare_target = min(candidates, key=lambda p: p.price)
    decoy = rng.choice([p for p in CATALOG if p.category not in (compare_category,) and p.id != search_target.id])
    return {
        "username": f"{first.lower()}.{last.lower()}{rng.randint(10, 99)}",
        "password": f"{rng.choice(_WORDS)}-{rng.choice(_WORDS)}-{rng.randint(10, 99)}",
        "search_product": search_target.id,
        "search_term": " ".join(search_target.name.split()[:2]),
        "compare_category": compare_category,
        "compare_target": compare_target.id,
        "decoy_product": decoy.id,
        "quantity": rng.choice([2, 3]),
        "delivery": {
            "name": f"{first} {last}",
            "phone": "01" + rng.choice("3456789") + "".join(str(rng.randint(0, 9)) for _ in range(8)),
            "address": f"House {rng.randint(2, 98)}, {rng.choice(_STREETS)}",
            "city": rng.choice(CITIES),
            "postcode": str(rng.randint(1000, 9999)),
            "option": rng.choice(["standard", "express"]),
        },
    }


# -- progress ----------------------------------------------------------------------

def progress(events: List[Any]) -> Dict[str, str]:
    """Task -> 'done' | 'skipped' | 'open' from the session's task events."""
    state = {t: "open" for t in TASKS}
    for e in events:
        if e["task"] in state and e["event"] in ("complete", "skip") and state[e["task"]] == "open":
            state[e["task"]] = "done" if e["event"] == "complete" else "skipped"
    return state


def current_task(events: List[Any]) -> Optional[str]:
    state = progress(events)
    return next((t for t in TASKS if state[t] == "open"), None)


def check_checkout(form: Dict[str, str], params: Dict[str, Any]) -> Dict[str, bool]:
    """Which fields match the requested delivery details (only these booleans are stored)."""
    d = params["delivery"]
    return {
        "name": same_text(form.get("name", ""), d["name"]),
        "phone": normalize_words(form.get("phone", "")) == [d["phone"]],
        "address": same_text(form.get("address", ""), d["address"]),
        "city": form.get("city", "") == d["city"],
        "postcode": form.get("postcode", "").strip() == d["postcode"],
        "option": form.get("option", "") == d["option"],
        "note": len(form.get("note", "").strip()) >= 10,
    }
