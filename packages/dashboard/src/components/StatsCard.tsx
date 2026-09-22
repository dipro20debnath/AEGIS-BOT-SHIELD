import React from 'react';

interface Props {
  title: string;
  value: string | number;
  trend: number;
  isGood: boolean;
  isDarkTheme: boolean;
}

const StatsCard: React.FC<Props> = ({ title, value, trend, isGood, isDarkTheme }) => {
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center'
  };

  const trendColor = isGood ? (trend >= 0 ? '#00C49F' : '#ff4d4f') : (trend >= 0 ? '#ff4d4f' : '#00C49F');
  const arrow = trend >= 0 ? '↑' : '↓';

  return (
    <div style={cardStyle}>
      <div style={{ color: isDarkTheme ? '#aaa' : '#666', fontSize: '14px', marginBottom: '8px', fontWeight: 'bold' }}>
        {title.toUpperCase()}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>
        {value}
      </div>
      <div style={{ fontSize: '14px', color: trendColor, fontWeight: 'bold' }}>
        {arrow} {Math.abs(trend)}% from last week
      </div>
    </div>
  );
};

export default StatsCard;
