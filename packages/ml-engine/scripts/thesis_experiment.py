"""
Reproducible synthetic-data experiment for the thesis.

Runs the full training pipeline (threshold tuning, per-category and group
ablation, plots) and adds per-bot-type recall and single-request latency.

Usage (from packages/ml-engine):
    python scripts/thesis_experiment.py --out ../../docs/thesis/results/synthetic
"""
import argparse
import json
import os
import sys
import tempfile
import time
import warnings

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
warnings.filterwarnings('ignore')

from aegis_ml.features.extractor import FeatureExtractor  # noqa: E402
from aegis_ml.inference.inference import InferenceEngine  # noqa: E402
from aegis_ml.training.synthetic_generator import BOT_TYPES, SyntheticDataGenerator  # noqa: E402
from aegis_ml.training.training import TrainingPipeline  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--n-per-class', type=int, default=2500)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--max-fpr', type=float, default=0.02)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    data, labels = SyntheticDataGenerator(args.seed).generate(args.n_per_class, args.n_per_class)

    model_dir = tempfile.mkdtemp()
    pipeline = TrainingPipeline(output_dir=model_dir)
    results = pipeline.train(data, labels, max_fpr=args.max_fpr)
    clf = pipeline.classifier

    # Per-bot-type recall and human FPR on a fresh, independently seeded set
    extractor = FeatureExtractor()
    fresh = SyntheticDataGenerator(args.seed + 1000)
    humans = extractor.extract_batch([fresh._generate_human() for _ in range(2000)])
    per_type = {'human_fpr': float(clf.predict(humans).mean())}
    for bot_type in BOT_TYPES:
        bots = extractor.extract_batch([fresh._generate_bot(bot_type) for _ in range(1000)])
        per_type[bot_type + '_recall'] = float(clf.predict(bots).mean())

    # Single-request latency through the inference engine (cache bypassed)
    engine = InferenceEngine(model_path=os.path.join(model_dir, 'bot_classifier.pkl'))
    samples = [fresh._generate_bot('replay_bot') if i % 2 else fresh._generate_human()
               for i in range(2000)]
    latencies = []
    for i, sample in enumerate(samples):
        start = time.perf_counter()
        engine.predict(f'client-{i}', sample)
        latencies.append((time.perf_counter() - start) * 1000)
    latencies = np.array(latencies)
    latency = {'mean_ms': float(latencies.mean()),
               'p50_ms': float(np.percentile(latencies, 50)),
               'p95_ms': float(np.percentile(latencies, 95)),
               'p99_ms': float(np.percentile(latencies, 99))}

    for name in ('thesis_report.md', 'metrics.csv', 'roc_curve.png',
                 'confusion_matrix.png', 'feature_importance.png'):
        os.replace(os.path.join(model_dir, name), os.path.join(args.out, name))

    with open(os.path.join(args.out, 'thesis_report.md'), 'a') as f:
        f.write('\n## 4. Per Bot Type (fresh test set, tuned threshold)\n')
        f.write('| Class | Rate |\n|-------|------|\n')
        for key, val in per_type.items():
            f.write(f'| {key} | {val:.4f} |\n')
        f.write('\n## 5. Inference Latency (2000 uncached single requests)\n')
        f.write('| mean | p50 | p95 | p99 |\n|------|-----|-----|-----|\n')
        f.write(f"| {latency['mean_ms']:.3f} ms | {latency['p50_ms']:.3f} ms | "
                f"{latency['p95_ms']:.3f} ms | {latency['p99_ms']:.3f} ms |\n")

    summary = {k: v for k, v in results.items() if k != 'train'}
    summary.update({'per_bot_type': per_type, 'latency': latency,
                    'config': vars(args)})
    with open(os.path.join(args.out, 'results.json'), 'w') as f:
        json.dump(summary, f, indent=2, default=float)

    print(open(os.path.join(args.out, 'thesis_report.md')).read())


if __name__ == '__main__':
    main()
