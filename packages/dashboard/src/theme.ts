/**
 * Colour tokens. Chrome and status colours follow the dataviz reference palette;
 * dark mode uses its own steps (not an automatic inversion).
 */
export interface Theme {
  dark: boolean;
  page: string;
  surface: string;
  text: string;
  textSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  series1: string;
  accent: string;
}

export const lightTheme: Theme = {
  dark: false,
  page: '#f9f9f7',
  surface: '#fcfcfb',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  series1: '#2a78d6',
  accent: '#2a78d6',
};

export const darkTheme: Theme = {
  dark: true,
  page: '#0d0d0d',
  surface: '#1a1a19',
  text: '#ffffff',
  textSecondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  border: 'rgba(255,255,255,0.10)',
  series1: '#3987e5',
  accent: '#3987e5',
};

/** Verdicts are states, so they use the status palette (always shown with a text label). */
export const VERDICT_COLORS: Record<string, string> = {
  allow: '#0ca30c',
  monitor: '#fab219',
  challenge: '#ec835a',
  block: '#d03b3b',
};

export const VERDICT_ORDER = ['allow', 'monitor', 'challenge', 'block'] as const;

export const cardStyle = (t: Theme): React.CSSProperties => ({
  backgroundColor: t.surface,
  border: `1px solid ${t.border}`,
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
});
