"""
A simulated study export (same files and columns as `python -m aegis_study export`),
built from the synthetic generator. For testing the analysis pipeline and for a dry
run before real data exist. **Its numbers are not results.**

Each participant gets several page views that share a personal baseline (so rows of
one person are correlated, as in the real study) and a few 15-second snapshots per
page view.
"""
import csv
import os
from typing import Optional

import numpy as np

from ..features.extractor import FeatureExtractor
from ..training.synthetic_generator import BOT_TYPES, SyntheticDataGenerator


def simulate_export(out_dir: str, n_humans: int = 40, runs_per_tool: int = 6, pages: int = 8,
                    seed: int = 7, self_share: float = 0.3, flagged_share: float = 0.1,
                    tools: Optional[list] = None) -> str:
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.RandomState(seed)
    gen = SyntheticDataGenerator(seed)
    ex = FeatureExtractor()
    names = ex.all_feature_names
    tools = tools or list(BOT_TYPES)
    people = [("human", None)] * n_humans + [("bot", t) for t in tools for _ in range(runs_per_tool)]
    sessions, telemetry = [], []
    for i, (label, tool) in enumerate(people):
        pid, sid = f"p{i:04d}", f"s{i:04d}"
        human = label == "human"
        base = ex.extract(gen._generate_human() if human else gen._generate_bot(tool)).features
        sessions.append({
            "session_id": sid, "participant": pid, "label": label, "bot_tool": tool or "",
            "code_source": ("self" if rng.rand() < self_share else "researcher") if human else "researcher",
            "post_autofill": "yes" if human and rng.rand() < flagged_share else "no",
            "post_tools": "no", "post_assistive": "no", "post_interrupted": "no",
        })
        t = 0.0
        for page in range(pages):
            final = base * (1 + rng.normal(0, 0.15, len(base)))
            snaps = rng.randint(1, 4)
            for k in range(snaps):
                t += 15 if k else rng.uniform(3, 20)
                vec = final * ((k + 1) / snaps) ** 0.5 if k < snaps - 1 else final
                score = 100 * np.clip((0.55 if not human else 0.2) + rng.normal(0, 0.2), 0, 1)
                telemetry.append({"session_id": sid, "participant": pid, "label": label, "bot_tool": tool or "",
                                  "stream": f"{sid}-{page}", "t_s": round(t, 1), "is_final": int(k == snaps - 1),
                                  "score": round(float(score), 1), **dict(zip(names, map(float, vec)))})
    for name, rows in (("sessions.csv", sessions), ("telemetry.csv", telemetry)):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    return out_dir
