import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import results from '@results/synthetic/results.json';
import StatsCard from '../components/StatsCard';
import { Theme, cardStyle } from '../theme';

/**
 * Results of packages/ml-engine/scripts/thesis_experiment.py, bundled at build
 * time from docs/thesis/results/synthetic/results.json.
 */
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const GROUP_LABELS: Record<string, string> = {
  full: 'All 50 features',
  without_behavior: 'without behaviour', only_behavior: 'only behaviour',
  without_session: 'without session', only_session: 'only session',
  without_network: 'without network', only_network: 'only network',
  without_fingerprint: 'without fingerprint', only_fingerprint: 'only fingerprint',
};

const MLPerformance: React.FC<{ theme: Theme }> = ({ theme }) => {
  const test = results.test;
  const tuning = results.threshold_tuning;
  const groups = Object.entries(results.group_ablation).map(([key, m]) => ({
    name: GROUP_LABELS[key] ?? key,
    recall: +(m.recall_at_fpr * 100).toFixed(1),
    label: `${(m.recall_at_fpr * 100).toFixed(1)}% ±${(m.recall_at_fpr_std * 100).toFixed(1)}`,
  }));
  const bots = Object.entries(results.per_bot_type).filter(([k]) => k.endsWith('_recall'))
    .map(([k, v]) => ({ name: k.replace('_recall', '').replace(/_/g, ' '), recall: +(Number(v) * 100).toFixed(1) }));
  const [[tn, fp], [fn, tp]] = test.confusion_matrix;

  const axis = { stroke: theme.axis, tick: { fill: theme.muted, fontSize: 12 } };
  const tooltip = { contentStyle: { backgroundColor: theme.surface, border: `1px solid ${theme.border}`, color: theme.text }, cursor: { fill: theme.grid } };
  const cell: React.CSSProperties = { padding: 8, borderBottom: `1px solid ${theme.grid}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>ML Engine</h1>
      <div role="note" style={{ ...cardStyle(theme), borderColor: '#fab219', color: theme.text }}>
        <strong>Synthetic-data experiment</strong> ({results.config.n_per_class} humans + {results.config.n_per_class} bots, seed {results.config.seed}).
        These numbers show the pipeline works; they are not real-world accuracy. Regenerate with{' '}
        <code>python packages/ml-engine/scripts/thesis_experiment.py --out docs/thesis/results/synthetic</code>.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <StatsCard theme={theme} title="F1 (hold-out)" value={pct(test.f1)} detail={`threshold ${test.threshold.toFixed(3)}`} />
        <StatsCard theme={theme} title="False positive rate" value={pct(test.fpr)} detail={`target ≤ ${pct(tuning.max_fpr)}`} />
        <StatsCard theme={theme} title="Bot recall" value={pct(test.recall)} detail={`precision ${pct(test.precision)}`} />
        <StatsCard theme={theme} title="AUC-ROC" value={test.auc_roc.toFixed(4)} />
        <StatsCard theme={theme} title="Inference latency p95" value={`${results.latency.p95_ms.toFixed(2)} ms`} detail={`p99 ${results.latency.p99_ms.toFixed(2)} ms`} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ ...cardStyle(theme), flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Confusion matrix (hold-out, tuned threshold)</h3>
          <table style={{ borderCollapse: 'collapse', color: theme.text, fontSize: 15 }}>
            <thead><tr style={{ color: theme.textSecondary }}><th></th><th style={cell}>predicted human</th><th style={cell}>predicted bot</th></tr></thead>
            <tbody>
              <tr><th style={{ ...cell, textAlign: 'left', color: theme.textSecondary }}>actual human</th><td style={cell}>{tn}</td><td style={cell}>{fp}</td></tr>
              <tr><th style={{ ...cell, textAlign: 'left', color: theme.textSecondary }}>actual bot</th><td style={cell}>{fn}</td><td style={cell}>{tp}</td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ ...cardStyle(theme), flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Decision threshold</h3>
          <table style={{ borderCollapse: 'collapse', color: theme.text, fontSize: 14, width: '100%' }}>
            <thead><tr style={{ color: theme.textSecondary }}>
              <th style={{ ...cell, textAlign: 'left' }}>threshold</th><th style={cell}>recall</th><th style={cell}>FPR</th><th style={cell}>F1</th>
            </tr></thead>
            <tbody>
              {[results.test_default, test].map(m => (
                <tr key={m.threshold}><td style={{ ...cell, textAlign: 'left' }}>{m.threshold.toFixed(4)}</td>
                  <td style={cell}>{pct(m.recall)}</td><td style={cell}>{pct(m.fpr)}</td><td style={cell}>{m.f1.toFixed(4)}</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: theme.textSecondary, fontSize: 13 }}>
            Tuned for FPR ≤ {pct(tuning.tuning_fpr)} on out-of-fold predictions of {tuning.n_held_out_humans} humans.
          </p>
        </div>
      </div>

      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Group ablation: bot recall at FPR ≤ {pct(tuning.max_fpr)} (5-fold CV, ±1 std)</h3>
        <div style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groups} layout="vertical" margin={{ left: 30, right: 90 }}>
              <CartesianGrid horizontal={false} stroke={theme.grid} />
              <XAxis type="number" domain={[0, 100]} unit="%" {...axis} />
              <YAxis type="category" dataKey="name" width={150} {...axis} />
              <Tooltip {...tooltip} formatter={(v: number) => `${v}%`} />
              <Bar dataKey="recall" name="recall" fill={theme.series1} radius={[0, 4, 4, 0]} barSize={18}>
                <LabelList dataKey="label" position="right" fill={theme.textSecondary} fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Recall per bot type (fresh test set; human FPR {pct(results.per_bot_type.human_fpr)})</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bots} layout="vertical" margin={{ left: 30, right: 50 }}>
              <CartesianGrid horizontal={false} stroke={theme.grid} />
              <XAxis type="number" domain={[0, 100]} unit="%" {...axis} />
              <YAxis type="category" dataKey="name" width={150} {...axis} />
              <Tooltip {...tooltip} formatter={(v: number) => `${v}%`} />
              <Bar dataKey="recall" name="recall" fill={theme.series1} radius={[0, 4, 4, 0]} barSize={18}>
                <LabelList dataKey="recall" position="right" fill={theme.textSecondary} fontSize={12} formatter={(v: number) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default MLPerformance;
