import React from 'react';
import { VERDICT_COLORS } from '../theme';

const ICONS: Record<string, string> = { allow: '✓', monitor: '◐', challenge: '!', block: '✕' };

/** Verdict label with status colour and icon, so colour never carries meaning alone. */
const VerdictBadge: React.FC<{ verdict: string }> = ({ verdict }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
    <span aria-hidden style={{
      width: 18, height: 18, borderRadius: 9, backgroundColor: VERDICT_COLORS[verdict] ?? '#898781',
      color: '#fff', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{ICONS[verdict] ?? '?'}</span>
    {verdict}
  </span>
);

export default VerdictBadge;
