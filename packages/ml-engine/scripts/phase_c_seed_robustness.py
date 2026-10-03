"""
Seed robustness of the trajectory results: repeats the C3 experiment with
several seeds (fresh data, splits and network initialisation each time) and
reports mean and standard deviation per model and protocol.

    python scripts/phase_c_seed_robustness.py --out ../../docs/thesis/results/phase_c --seeds 1 2 3
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from aegis_ml.evaluation import trajectory_experiment as te  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--seeds', type=int, nargs='+', default=[1, 2, 3])
    ap.add_argument('--n-human', type=int, default=1000)
    ap.add_argument('--n-bot-per-type', type=int, default=200)
    ap.add_argument('--epochs', type=int, default=15)
    args = ap.parse_args()
    runs = [te.run(args.n_human, args.n_bot_per_type, seed=s, epochs=args.epochs) for s in args.seeds]
    for r in runs:
        r.pop('mixed_test', None)

    def agg(get):
        vals = np.array([get(r) for r in runs])
        return {'mean': float(vals.mean()), 'std': float(vals.std(ddof=1)) if len(vals) > 1 else 0.0,
                'values': vals.tolist()}

    models = list(runs[0]['mixed'])
    types = list(runs[0]['leave_one_type_out'])
    summary = {
        'seeds': args.seeds,
        'mixed_auc': {m: agg(lambda r, m=m: r['mixed'][m]['auc_roc']) for m in models},
        'loto_recall_at_2pct_fpr': {t: {m: agg(lambda r, t=t, m=m: r['leave_one_type_out'][t][m]['recall_at_2pct_fpr'])
                                        for m in models} for t in types},
    }
    with open(os.path.join(args.out, 'seed_robustness.json'), 'w') as f:
        json.dump({'summary': summary, 'runs': runs, 'config': vars(args)}, f, indent=2, default=float)
    lines = [f"## C3b. Seed robustness ({len(args.seeds)} seeds: {args.seeds}; {args.n_human} humans + "
             f"{args.n_bot_per_type} per bot type, {args.epochs} epochs)", '',
             'Mixed split, AUC-ROC mean ± sd:', '', '| ' + ' | '.join(models) + ' |', '|---' * len(models) + '|',
             '| ' + ' | '.join(f"{summary['mixed_auc'][m]['mean']:.4f} ± {summary['mixed_auc'][m]['std']:.4f}"
                               for m in models) + ' |', '',
             'Unseen bot type, recall @ 2% FPR mean ± sd:', '',
             '| Held-out type | ' + ' | '.join(models) + ' |', '|---' * (len(models) + 1) + '|']
    for t in types:
        row = summary['loto_recall_at_2pct_fpr'][t]
        lines.append(f'| {t} | ' + ' | '.join(f"{row[m]['mean']:.2f} ± {row[m]['std']:.2f}" for m in models) + ' |')
    with open(os.path.join(args.out, 'report.md'), 'a') as f:
        f.write('\n' + '\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
