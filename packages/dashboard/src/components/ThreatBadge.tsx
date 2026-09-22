import React from 'react';

interface Props {
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
}

const ThreatBadge: React.FC<Props> = ({ severity }) => {
  const getStyle = () => {
    switch (severity) {
      case 'Critical': return { bg: '#ffe5e5', color: '#ff4d4f', border: '1px solid #ff4d4f' };
      case 'High': return { bg: '#fff1b8', color: '#faad14', border: '1px solid #faad14' };
      case 'Medium': return { bg: '#e6f7ff', color: '#1890ff', border: '1px solid #1890ff' };
      case 'Low': return { bg: '#f6ffed', color: '#52c41a', border: '1px solid #52c41a' };
      default: return { bg: '#eee', color: '#333', border: 'none' };
    }
  };
  
  const style = getStyle();
  
  return (
    <span style={{
      backgroundColor: style.bg,
      color: style.color,
      border: style.border,
      padding: '4px 8px',
      borderRadius: '12px',
      fontSize: '0.85em',
      fontWeight: 'bold',
      display: 'inline-block'
    }}>
      {severity}
    </span>
  );
};

export default ThreatBadge;
