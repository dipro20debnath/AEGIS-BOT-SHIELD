"""
Analysis of the real study dataset (thesis Ch. 6), from the export of the study
site (`python -m aegis_study export --out DIR`).

Differences from the synthetic experiments, all because rows of one person are
correlated:
- one row = the final telemetry report of one page view (`is_final == 1`);
- cross-validation folds are split **by participant** (StratifiedGroupKFold),
  never by row;
- 95% CIs come from a **cluster bootstrap**: participants (not rows) are
  resampled, within each class.

Every result is computed for three subsets of the data:
- `all`: every labelled session;
- `researcher_codes`: drops self-made tickets (`code_source == self`), whose
  "human" label is not invitation-checked;
- `unflagged`: drops human sessions whose closing survey reports autofill,
  automation tools, assistive tools or an interruption.

Also reported:
- the live AEGIS score recorded during the study (the model trained on
  synthetic data), i.e. how well synthetic training transfers to real data;
- feature-group ablation;
- leave-one-bot-tool-out;
- time to detection from the 15-second telemetry snapshots;
- sample-size warnings.
"""
import csv
import os
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

from ..features.extractor import FeatureExtractor
from .compare import model_factories
from .stats import METRICS, recall_at_fpr

#: Closing-survey answers that mark a human session as possibly not ordinary use
FLAG_COLUMNS = ("post_autofill", "post_tools", "post_assistive", "post_interrupted")
#: Seconds after the start of a session at which detection is reported
DETECTION_TIMES = (5, 15, 30, 60, 120, 300)
FPR_BUDGET = 0.02


@dataclass
class StudyData:
    """All labelled telemetry rows; `final` marks the one row per page view used for training."""
    X: np.ndarray
    y: np.ndarray            # 1 = bot
    participant: np.ndarray
    session: np.ndarray
    tool: np.ndarray         # bot tool, "human" for humans
    t_s: np.ndarray          # seconds since the session started
    final: np.ndarray        # bool
    live_score: np.ndarray   # AEGIS score recorded live, 0..100 (nan if missing)
    source: np.ndarray       # code source: researcher | self
    flagged: np.ndarray      # bool, human session flagged in the closing survey
    feature_names: List[str]

    def subset(self, mask: np.ndarray) -> "StudyData":
        return StudyData(*(getattr(self, f)[mask] for f in (
            "X", "y", "participant", "session", "tool", "t_s", "final", "live_score", "source", "flagged")),
            feature_names=self.feature_names)


def _num(value: Optional[str]) -> float:
    if value in (None, ""):
        return 0.0
    if value in ("True", "true"):
        return 1.0
    if value in ("False", "false"):
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def load_export(path: str) -> StudyData:
    """Read sessions.csv and telemetry.csv of a study export."""
    with open(os.path.join(path, "sessions.csv"), encoding="utf-8", newline="") as f:
        sessions = {r["session_id"]: r for r in csv.DictReader(f)}
    names = FeatureExtractor().all_feature_names
    rows = []
    with open(os.path.join(path, "telemetry.csv"), encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing = [n for n in names if n not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"telemetry.csv lacks feature columns, e.g. {missing[:3]}")
        for r in reader:
            if r["label"] in ("human", "bot") and r["session_id"] in sessions:
                rows.append(r)
    if not rows:
        raise ValueError("no labelled telemetry rows in this export")

    def session_flagged(s: Dict[str, str]) -> bool:
        return s.get("label") == "human" and any(s.get(c) == "yes" for c in FLAG_COLUMNS)

    return StudyData(
        X=np.array([[_num(r[n]) for n in names] for r in rows], dtype=np.float64),
        y=np.array([1 if r["label"] == "bot" else 0 for r in rows]),
        participant=np.array([r["participant"] for r in rows]),
        session=np.array([r["session_id"] for r in rows]),
        tool=np.array([(r["bot_tool"] or "unknown") if r["label"] == "bot" else "human" for r in rows]),
        t_s=np.array([_num(r["t_s"]) for r in rows]),
        final=np.array([r["is_final"] == "1" for r in rows]),
        live_score=np.array([float(r["score"]) if r.get("score") not in (None, "") else np.nan for r in rows]),
        source=np.array([sessions[r["session_id"]].get("code_source") or "researcher" for r in rows]),
        flagged=np.array([session_flagged(sessions[r["session_id"]]) for r in rows]),
        feature_names=list(names),
    )


# -- grouped cross-validation and cluster bootstrap ----------------------------------------------

def n_folds(y: np.ndarray, groups: np.ndarray, wanted: int = 5) -> int:
    """Folds possible when every fold must hold at least one participant of each class."""
    per_class = min(len(np.unique(groups[y == c])) for c in (0, 1))
    return max(2, min(wanted, per_class))


def grouped_oof(factory: Callable[[], object], X: np.ndarray, y: np.ndarray, groups: np.ndarray,
                folds: int, seed: int = 42, X_all: Optional[np.ndarray] = None,
                groups_all: Optional[np.ndarray] = None):
    """Out-of-fold bot probabilities with participant-grouped folds.

    With X_all/groups_all (e.g. every telemetry snapshot), the fold models also score
    those rows, each by the model that did not see its participant."""
    probs = np.zeros(len(y))
    probs_all = np.zeros(len(X_all)) if X_all is not None else None
    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
    for train, test in splitter.split(X, y, groups):
        model = factory().fit(X[train], y[train])
        probs[test] = model.predict_proba(X[test])[:, 1]
        if X_all is not None:
            held_out = np.isin(groups_all, np.unique(groups[test]))
            probs_all[held_out] = model.predict_proba(X_all[held_out])[:, 1]
    return probs if X_all is None else (probs, probs_all)


def cluster_bootstrap_indices(y: np.ndarray, groups: np.ndarray, n_boot: int, seed: int) -> List[np.ndarray]:
    """Resample participants with replacement within each class; return row indices per resample."""
    rng = np.random.RandomState(seed)
    by_group = {g: np.where(groups == g)[0] for g in np.unique(groups)}
    classes = [np.array([g for g in by_group if y[by_group[g][0]] == c]) for c in (0, 1)]
    out = []
    for _ in range(n_boot):
        picked = np.concatenate([rng.choice(gs, len(gs)) for gs in classes if len(gs)])
        out.append(np.concatenate([by_group[g] for g in picked]))
    return out


def metric_ci(y: np.ndarray, probs: np.ndarray, metric: str, boots: Sequence[np.ndarray]) -> Dict[str, float]:
    fn = METRICS[metric]
    samples = [fn(y[i], probs[i]) for i in boots if len(np.unique(y[i])) == 2]
    return {"value": fn(y, probs), "ci_low": float(np.percentile(samples, 2.5)),
            "ci_high": float(np.percentile(samples, 97.5))}


def threshold_at_fpr(human_probs: np.ndarray, max_fpr: float = FPR_BUDGET) -> float:
    """Score above which at most max_fpr of the human rows lie."""
    if not len(human_probs):
        return 0.5
    return float(np.quantile(human_probs, 1 - max_fpr, method="higher"))


# -- analyses ------------------------------------------------------------------------------------

def sample_sizes(d: StudyData) -> Dict:
    f = d.final
    out = {
        "participants": {"human": int(len(np.unique(d.participant[f & (d.y == 0)]))),
                         "bot": int(len(np.unique(d.participant[f & (d.y == 1)])))},
        "page_views": {"human": int((f & (d.y == 0)).sum()), "bot": int((f & (d.y == 1)).sum())},
        "snapshots": int(len(d.y)),
        "bot_tools": {str(t): int(len(np.unique(d.participant[f & (d.tool == t)])))
                      for t in np.unique(d.tool[d.y == 1])},
        "self_ticket_humans": int(len(np.unique(d.participant[f & (d.y == 0) & (d.source == "self")]))),
        "flagged_human_sessions": int(len(np.unique(d.session[d.flagged]))),
    }
    warnings = []
    if out["participants"]["human"] < 30:
        warnings.append(f"Only {out['participants']['human']} human participants: the 2%-FPR operating point "
                        "rests on very few people, so its CI is wide. Aim for 30 or more.")
    if out["participants"]["bot"] < 10:
        warnings.append(f"Only {out['participants']['bot']} bot runs: add more runs per tool.")
    for tool, n in out["bot_tools"].items():
        if n < 3:
            warnings.append(f"Bot tool '{tool}' has {n} run(s): its per-tool recall is anecdotal.")
    out["warnings"] = warnings
    return out


def evaluate(d: StudyData, models: Dict[str, Callable], n_boot: int = 1000, seed: int = 42) -> Dict:
    """Grouped-CV metrics with cluster-bootstrap CIs, per-tool recall, and the live score."""
    f = d.final
    X, y, g = d.X[f], d.y[f], d.participant[f]
    folds = n_folds(y, g)
    boots = cluster_bootstrap_indices(y, g, n_boot, seed)
    result: Dict = {"folds": folds, "n_bootstrap": n_boot, "models": {}}
    oof = {}
    for name, factory in models.items():
        p = grouped_oof(factory, X, y, g, folds, seed)
        oof[name] = p
        thr = threshold_at_fpr(p[y == 0])
        result["models"][name] = {
            **{m: metric_ci(y, p, m, boots) for m in METRICS},
            "per_tool_recall_at_2pct_fpr": {str(t): float((p[d.tool[f] == t] > thr).mean())
                                            for t in np.unique(d.tool[f][y == 1])},
        }
    live = d.live_score[f]
    if np.isfinite(live).all():
        p = live / 100.0
        result["live_score"] = {m: metric_ci(y, p, m, boots) for m in METRICS}
        result["live_score"]["recall_at_score_50"] = float((p[y == 1] >= 0.5).mean())
        result["live_score"]["humans_at_score_50"] = float((p[y == 0] >= 0.5).mean())
    result["oof"] = oof
    return result


def group_ablation(d: StudyData, factory: Callable, seed: int = 42) -> Dict[str, Dict[str, float]]:
    """Drop one feature group at a time (grouped CV): how much does each group contribute?"""
    f = d.final
    X, y, g = d.X[f], d.y[f], d.participant[f]
    folds = n_folds(y, g)
    ex = FeatureExtractor()

    def score(cols: np.ndarray) -> Dict[str, float]:
        p = grouped_oof(factory, X[:, cols], y, g, folds, seed)
        return {"auc_roc": METRICS["auc_roc"](y, p), "recall_at_2pct_fpr": recall_at_fpr(y, p, FPR_BUDGET)}

    every = np.arange(X.shape[1])
    out = {"all_features": score(every)}
    for group in ex.FEATURE_CATEGORIES:
        drop = set(ex.category_indices[group])
        out[f"without_{group}"] = score(np.array([i for i in every if i not in drop]))
    return out


def leave_one_tool_out(d: StudyData, factory: Callable, seed: int = 42) -> Dict[str, Dict[str, float]]:
    """Train without one bot tool, test on held-out humans plus that tool: unseen automation."""
    f = d.final
    X, y, g, tool = d.X[f], d.y[f], d.participant[f], d.tool[f]
    rng = np.random.RandomState(seed)
    humans = np.unique(g[y == 0])
    rng.shuffle(humans)
    test_humans = set(humans[: len(humans) // 2])
    is_test_human = np.array([(yy == 0 and gg in test_humans) for yy, gg in zip(y, g)])
    out = {}
    for t in np.unique(tool[y == 1]):
        train = ((y == 0) & ~is_test_human) | ((y == 1) & (tool != t))
        test = is_test_human | (tool == t)
        if len(np.unique(y[train])) < 2 or len(np.unique(y[test])) < 2:
            continue
        p = factory().fit(X[train], y[train]).predict_proba(X[test])[:, 1]
        out[str(t)] = {"auc_roc": METRICS["auc_roc"](y[test], p),
                       "recall_at_2pct_fpr": recall_at_fpr(y[test], p, FPR_BUDGET)}
    return out


def time_to_detection(d: StudyData, factory: Callable, seed: int = 42,
                      times: Sequence[int] = DETECTION_TIMES) -> Dict:
    """Share of bot sessions flagged by t seconds, scoring every 15-second snapshot.

    Models are trained on final rows of the other participants; the threshold allows
    2% of human snapshots above it. Also reported: the share of human sessions flagged
    at least once (a session-level false alarm rate)."""
    f = d.final
    folds = n_folds(d.y[f], d.participant[f])
    _, p_all = grouped_oof(factory, d.X[f], d.y[f], d.participant[f], folds, seed,
                           X_all=d.X, groups_all=d.participant)
    thr = threshold_at_fpr(p_all[d.y == 0])
    first_hit: Dict[str, float] = {}
    for s in np.unique(d.session):
        rows = np.where(d.session == s)[0]
        hits = d.t_s[rows][p_all[rows] > thr]
        first_hit[s] = float(hits.min()) if len(hits) else np.inf
    sessions_bot = [s for s in first_hit if d.y[d.session == s][0] == 1]
    sessions_human = [s for s in first_hit if d.y[d.session == s][0] == 0]
    return {
        "threshold": thr,
        "bot_sessions_detected_by": {f"{t}s": float(np.mean([first_hit[s] <= t for s in sessions_bot]))
                                     for t in times},
        "bot_sessions_ever_detected": float(np.mean([np.isfinite(first_hit[s]) for s in sessions_bot])),
        "human_sessions_ever_flagged": float(np.mean([np.isfinite(first_hit[s]) for s in sessions_human])),
        "median_seconds_to_detect": float(np.median([first_hit[s] for s in sessions_bot
                                                     if np.isfinite(first_hit[s])]))
        if any(np.isfinite(first_hit[s]) for s in sessions_bot) else None,
    }


def subsets(d: StudyData) -> Dict[str, np.ndarray]:
    """Row masks of the three data subsets every result is reported for."""
    return {
        "all": np.ones(len(d.y), dtype=bool),
        "researcher_codes": (d.y == 1) | (d.source != "self"),
        "unflagged": ~d.flagged,
    }


def analyse(d: StudyData, n_boot: int = 1000, seed: int = 42, models: Optional[Dict[str, Callable]] = None,
            main_model: Optional[str] = None) -> Dict:
    sizes = sample_sizes(d)
    if min(sizes["participants"].values()) < 2:
        raise ValueError(f"need at least 2 human and 2 bot participants, found {sizes['participants']}")
    models = models or model_factories(seed)
    main_model = main_model or ("xgboost" if "xgboost" in models else next(iter(models)))
    result: Dict = {"sample_sizes": sizes, "main_model": main_model, "subsets": {}}
    for name, mask in subsets(d).items():
        part = d.subset(mask)
        if len(np.unique(part.y[part.final])) < 2:
            result["subsets"][name] = {"skipped": "only one class"}
            continue
        res = evaluate(part, models, n_boot, seed)
        res.pop("oof")
        result["subsets"][name] = {"n_participants": sample_sizes(part)["participants"], **res}
    result["ablation"] = group_ablation(d, models[main_model], seed)
    result["leave_one_tool_out"] = leave_one_tool_out(d, models[main_model], seed)
    result["time_to_detection"] = time_to_detection(d, models[main_model], seed)
    return result


# -- report --------------------------------------------------------------------------------------

def _ci(m: Dict[str, float]) -> str:
    return f"{m['value']:.3f} ({m['ci_low']:.3f}–{m['ci_high']:.3f})"


def report_markdown(r: Dict, title: str = "Study results") -> str:
    s = r["sample_sizes"]
    lines = [f"# {title}", "",
             "Grouped 5-fold CV by participant; 95% CIs from a cluster bootstrap over participants. "
             "Recall is measured at the threshold that flags at most 2% of human page views.", "",
             "## Data", "",
             f"- Participants: {s['participants']['human']} human, {s['participants']['bot']} bot runs",
             f"- Page views (final reports): {s['page_views']['human']} human, {s['page_views']['bot']} bot; "
             f"{s['snapshots']} telemetry snapshots in total",
             f"- Bot runs per tool: " + ", ".join(f"{t} {n}" for t, n in s["bot_tools"].items()),
             f"- Humans with self-made tickets: {s['self_ticket_humans']}; "
             f"human sessions flagged in the closing survey: {s['flagged_human_sessions']}", ""]
    if s["warnings"]:
        lines += ["**Warnings**", ""] + [f"- {w}" for w in s["warnings"]] + [""]
    for name, sub in r["subsets"].items():
        lines += [f"## Subset `{name}`", ""]
        if "skipped" in sub:
            lines += [f"Skipped: {sub['skipped']}.", ""]
            continue
        lines += ["| Model | AUC-ROC | PR-AUC | Recall @ 2% FPR |", "|---|---|---|---|"]
        for model, m in sub["models"].items():
            lines.append(f"| {model} | {_ci(m['auc_roc'])} | {_ci(m['pr_auc'])} | {_ci(m['recall_at_2pct_fpr'])} |")
        if "live_score" in sub:
            ls = sub["live_score"]
            lines.append(f"| live AEGIS score (synthetic-trained) | {_ci(ls['auc_roc'])} | {_ci(ls['pr_auc'])} | "
                         f"{_ci(ls['recall_at_2pct_fpr'])} |")
        lines.append("")
        main = sub["models"].get(r["main_model"])
        if main:
            lines += [f"Recall per bot tool ({r['main_model']}, 2% FPR): " + ", ".join(
                f"{t} {v:.2f}" for t, v in main["per_tool_recall_at_2pct_fpr"].items()), ""]
    lines += ["## Feature-group ablation (" + r["main_model"] + ", subset `all`)", "",
              "| Features | AUC-ROC | Recall @ 2% FPR |", "|---|---|---|"]
    for k, v in r["ablation"].items():
        lines.append(f"| {k} | {v['auc_roc']:.3f} | {v['recall_at_2pct_fpr']:.3f} |")
    lines += ["", "## Unseen bot tools (leave one tool out)", "",
              "| Held-out tool | AUC-ROC | Recall @ 2% FPR |", "|---|---|---|"]
    for k, v in r["leave_one_tool_out"].items():
        lines.append(f"| {k} | {v['auc_roc']:.3f} | {v['recall_at_2pct_fpr']:.3f} |")
    t = r["time_to_detection"]
    lines += ["", "## Time to detection (15-second snapshots)", "",
              "| By | " + " | ".join(t["bot_sessions_detected_by"]) + " |",
              "|---|" + "---|" * len(t["bot_sessions_detected_by"]),
              "| Bot sessions detected | " + " | ".join(f"{v:.2f}" for v in t["bot_sessions_detected_by"].values())
              + " |", "",
              f"Bot sessions ever detected: {t['bot_sessions_ever_detected']:.2f}. "
              f"Human sessions flagged at least once: {t['human_sessions_ever_flagged']:.2f}.", ""]
    return "\n".join(lines)
