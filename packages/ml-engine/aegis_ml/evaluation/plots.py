"""
Publication figures (300 dpi PNG + vector PDF).

Colour roles follow one validated palette (categorical slots 1-4 for models,
a single blue ramp for magnitudes). Two slots are below 3:1 contrast on the
surface, so every line also has its own line style and a legend (identity
never by colour alone, and readable in grayscale print).
"""
import os
from typing import Dict, List, Optional, Sequence

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from sklearn.metrics import precision_recall_curve, roc_curve  # noqa: E402

from .stats import bootstrap_indices  # noqa: E402

SURFACE, TEXT, TEXT_2, MUTED, GRID = '#fcfcfb', '#0b0b0b', '#52514e', '#898781', '#e4e3df'
SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
STYLES = ['-', '--', '-.', ':']
BLUES = LinearSegmentedColormap.from_list('aegis_blues', ['#eef4fc', '#9ec2ee', '#2a78d6', '#123d73'])

plt.rcParams.update({
    'figure.facecolor': SURFACE, 'axes.facecolor': SURFACE, 'savefig.facecolor': SURFACE,
    'axes.edgecolor': MUTED, 'axes.labelcolor': TEXT_2, 'xtick.color': MUTED, 'ytick.color': MUTED,
    'text.color': TEXT, 'axes.titlecolor': TEXT, 'axes.titlesize': 11, 'axes.labelsize': 9.5,
    'xtick.labelsize': 8.5, 'ytick.labelsize': 8.5, 'legend.fontsize': 8.5, 'legend.frameon': False,
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': GRID,
    'grid.linewidth': 0.6, 'axes.axisbelow': True, 'font.family': 'DejaVu Sans', 'lines.linewidth': 2.0,
})

PRETTY = {
    'logistic_regression': 'Logistic regression', 'random_forest': 'Random forest', 'xgboost': 'XGBoost',
    'stacked_ensemble': 'Stacked ensemble (AEGIS)', 'features_random_forest': 'Features + RF',
    'features_xgboost': 'Features + XGBoost', 'sequence_cnn': '1D-CNN (sequence)', 'sequence_lstm': 'Conv-LSTM (sequence)',
}


def _save(fig, out_dir: str, name: str) -> List[str]:
    paths = []
    for ext in ('pdf', 'png'):
        path = os.path.join(out_dir, f'{name}.{ext}')
        fig.savefig(path, dpi=300, bbox_inches='tight')
        paths.append(path)
    plt.close(fig)
    return paths


def _band(y, p, kind: str, grid: np.ndarray, n_boot: int, seed: int):
    curves = []
    for idx in bootstrap_indices(y, n_boot, seed):
        if kind == 'roc':
            fpr, tpr, _ = roc_curve(y[idx], p[idx])
            curves.append(np.interp(grid, fpr, tpr))
        else:
            prec, rec, _ = precision_recall_curve(y[idx], p[idx])
            curves.append(np.interp(grid, rec[::-1], prec[::-1]))
    curves = np.array(curves)
    return np.percentile(curves, 2.5, axis=0), np.percentile(curves, 97.5, axis=0)


def roc_pr_figure(y: np.ndarray, probs: Dict[str, np.ndarray], out_dir: str, name: str, title: str,
                  n_boot: int = 300, seed: int = 0, fpr_budget: float = 0.02) -> List[str]:
    """ROC (log FPR axis, operating budget marked) and precision-recall, with bootstrap 95% bands."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.2))
    fpr_grid = np.logspace(-3, 0, 200)
    rec_grid = np.linspace(0, 1, 200)
    for i, (model, p) in enumerate(probs.items()):
        c, ls = SERIES[i % 4], STYLES[i % 4]
        fpr, tpr, _ = roc_curve(y, p)
        lo, hi = _band(y, p, 'roc', fpr_grid, n_boot, seed)
        ax1.fill_between(fpr_grid, lo, hi, color=c, alpha=0.15, linewidth=0)
        ax1.plot(np.clip(fpr, 1e-3, 1), tpr, color=c, linestyle=ls, label=PRETTY.get(model, model))
        prec, rec, _ = precision_recall_curve(y, p)
        lo, hi = _band(y, p, 'pr', rec_grid, n_boot, seed)
        ax2.fill_between(rec_grid, lo, hi, color=c, alpha=0.15, linewidth=0)
        ax2.plot(rec, prec, color=c, linestyle=ls, label=PRETTY.get(model, model))
    ax1.axvline(fpr_budget, color=MUTED, linewidth=1, linestyle=(0, (2, 2)))
    ax1.text(fpr_budget * 1.08, 0.03, f'{fpr_budget:.0%} FPR budget', color=TEXT_2, fontsize=8)
    ax1.set(xscale='log', xlim=(1e-3, 1), ylim=(0, 1.01), xlabel='False-positive rate (humans flagged, log scale)',
            ylabel='True-positive rate (bots caught)', title='ROC')
    ax2.set(xlim=(0, 1.01), xlabel='Recall (bots caught)', ylabel='Precision', title='Precision-recall')
    lo_prec = min(0.5, ax2.get_ylim()[0])
    ax2.set_ylim(lo_prec, 1.01)
    ax2.legend(loc='lower left')
    fig.suptitle(title, x=0.01, ha='left', fontsize=12, color=TEXT)
    fig.text(0.01, -0.02, 'Shaded bands: stratified bootstrap 95% intervals.', color=TEXT_2, fontsize=8)
    fig.tight_layout()
    return _save(fig, out_dir, name)


def heatmap_figure(table: Dict[str, Dict[str, float]], out_dir: str, name: str, title: str,
                   value_label: str, row_order: Optional[Sequence[str]] = None) -> List[str]:
    """Rows = held-out bot types, columns = models; single-hue sequential colour + printed values."""
    rows = list(row_order or table.keys())
    cols = list(next(iter(table.values())).keys())
    data = np.array([[table[r][c] for c in cols] for r in rows])
    fig, ax = plt.subplots(figsize=(1.6 + 1.55 * len(cols), 0.9 + 0.48 * len(rows)))
    ax.imshow(data, cmap=BLUES, vmin=0, vmax=1, aspect='auto')
    ax.grid(False)
    for i in range(len(rows)):
        for j in range(len(cols)):
            v = data[i, j]
            ax.text(j, i, f'{v:.2f}', ha='center', va='center', fontsize=9,
                    color='#ffffff' if v > 0.62 else TEXT)
    ax.set_xticks(range(len(cols)), [PRETTY.get(c, c) for c in cols], rotation=20, ha='right', color=TEXT_2)
    ax.set_yticks(range(len(rows)), [r.replace('_', ' ') for r in rows], color=TEXT_2)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_ylabel('Bot type held out of training')
    ax.set_title(title, loc='left')
    fig.text(0.01, -0.03, value_label, color=TEXT_2, fontsize=8)
    fig.tight_layout()
    return _save(fig, out_dir, name)


def importance_figure(importance: Dict[str, float], groups: Dict[str, float], out_dir: str,
                      name: str = 'fig_shap_importance', top: int = 15) -> List[str]:
    items = list(importance.items())[:top][::-1]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.6), gridspec_kw={'width_ratios': [1.6, 1]})
    ax1.barh([k for k, _ in items], [v for _, v in items], height=0.6, color=SERIES[0])
    ax1.set(xlabel='Mean |SHAP value| (log-odds)', title=f'Top {top} features')
    ax1.grid(axis='y', visible=False)
    g = sorted(groups.items(), key=lambda kv: kv[1])
    ax2.barh([k for k, _ in g], [v for _, v in g], height=0.6, color=SERIES[0])
    ax2.set(xlabel='Mean |sum of SHAP values|', title='By feature category')
    ax2.grid(axis='y', visible=False)
    for ax in (ax1, ax2):
        ax.tick_params(axis='y', colors=TEXT_2)
    fig.suptitle('What drives the XGBoost component (TreeSHAP)', x=0.01, ha='left', fontsize=12)
    fig.tight_layout()
    return _save(fig, out_dir, name)


def trajectory_examples_figure(examples: Dict[str, np.ndarray], out_dir: str,
                               name: str = 'fig_trajectory_examples') -> List[str]:
    kinds = list(examples)
    fig, axes = plt.subplots(2, (len(kinds) + 1) // 2, figsize=(10, 5.2))
    for ax, kind in zip(axes.ravel(), kinds):
        tr = examples[kind]
        ax.plot(tr[:, 0], tr[:, 1], color=SERIES[0], linewidth=1.2)
        ax.scatter(tr[:, 0], tr[:, 1], s=3, color=SERIES[0], linewidths=0)
        ax.set_title(f'{kind}  ({len(tr)} events)', fontsize=9.5, loc='left')
        ax.invert_yaxis()
        ax.set_xticks([]), ax.set_yticks([])
        ax.grid(False)
    for ax in axes.ravel()[len(kinds):]:
        ax.axis('off')
    fig.suptitle('Synthetic mouse trajectories (dots = mousemove events)', x=0.01, ha='left', fontsize=12)
    fig.tight_layout()
    return _save(fig, out_dir, name)
