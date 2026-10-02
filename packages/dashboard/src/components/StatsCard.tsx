import React from 'react';
import { Theme, cardStyle } from '../theme';

interface Props {
  title: string;
  value: string | number;
  detail?: string;
  theme: Theme;
}

/** Stat tile: a single headline number with an optional one-line context. */
const StatsCard: React.FC<Props> = ({ title, value, detail, theme }) => (
  <div style={{ ...cardStyle(theme), flex: '1 1 0', minWidth: 150, marginBottom: 0 }}>
    <div style={{ color: theme.textSecondary, fontSize: 13, marginBottom: 8, fontWeight: 600 }}>{title}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: theme.text }}>{value}</div>
    {detail && <div style={{ fontSize: 13, color: theme.muted, marginTop: 6 }}>{detail}</div>}
  </div>
);

export default StatsCard;
