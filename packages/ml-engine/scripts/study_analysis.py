"""
Thesis results from the real study data.

    python -m aegis_study export --out dataset            # on the study server (in study/)
    python scripts/study_analysis.py --export dataset --out ../../docs/thesis/results/study

Writes results.json, REPORT.md and roc_pr.(png|pdf) to --out. See
aegis_ml/evaluation/study.py for the method (participant-grouped CV, cluster
bootstrap, three data subsets, ablation, unseen tools, time to detection).

    python scripts/study_analysis.py --simulate --out /tmp/dry-run

runs the same pipeline on a simulated export, to check the setup before real data
exist. Those numbers are NOT results.
"""
import argparse
import json
import os
import sys
import tempfile
import warnings

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
warnings.filterwarnings('ignore')

from aegis_ml.evaluation.compare import model_factories  # noqa: E402
from aegis_ml.evaluation.plots import roc_pr_figure  # noqa: E402
from aegis_ml.evaluation.study import analyse, evaluate, load_export, report_markdown  # noqa: E402
from aegis_ml.evaluation.study_sim import simulate_export  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--export', help='folder written by "python -m aegis_study export"')
    source.add_argument('--simulate', action='store_true', help='dry run on a simulated export (not results)')
    parser.add_argument('--out', required=True)
    parser.add_argument('--bootstrap', type=int, default=1000)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args(argv)

    export = args.export or simulate_export(tempfile.mkdtemp(prefix='aegis-sim-'))
    models = model_factories(args.seed)
    try:
        data = load_export(export)
        result = analyse(data, n_boot=args.bootstrap, seed=args.seed, models=models)
    except ValueError as err:
        print(f'cannot analyse {export}: {err}', file=sys.stderr)
        return 2
    result['simulated'] = bool(args.simulate)

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'results.json'), 'w') as f:
        json.dump(result, f, indent=2, default=float)
    title = 'Study results — SIMULATED DRY RUN, NOT RESULTS' if args.simulate else 'Study results'
    with open(os.path.join(args.out, 'REPORT.md'), 'w') as f:
        f.write(report_markdown(result, title) + '\n')
    oof = evaluate(data, models, n_boot=1, seed=args.seed)['oof']
    y = data.y[data.final]
    roc_pr_figure(y, oof, args.out, 'roc_pr', title, n_boot=200, seed=args.seed)
    print(report_markdown(result, title))
    return 0


if __name__ == '__main__':
    sys.exit(main())
