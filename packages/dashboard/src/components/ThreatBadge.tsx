import React from 'react';

interface ThreatBadgeProps {
  type: string;
}

export default function ThreatBadge({ type }: ThreatBadgeProps) {
  let color = 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  
  if (type.includes('Scraping') || type.includes('OAT-011')) color = 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  if (type.includes('Stuffing') || type.includes('OAT-001')) color = 'bg-red-500/20 text-red-400 border-red-500/30';
  if (type.includes('Scalping') || type.includes('OAT-008')) color = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';

  return (
    <span className={\`px-2 py-1 rounded text-xs font-medium border \${color}\`}>
      {type}
    </span>
  );
}
