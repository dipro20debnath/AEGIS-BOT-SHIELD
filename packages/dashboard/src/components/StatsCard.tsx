import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  trend: number;
  trendLabel?: string;
  color?: string;
}

export default function StatsCard({ title, value, icon: Icon, trend, trendLabel, color = 'text-aegis-blue' }: StatsCardProps) {
  const isPositive = trend > 0;
  
  return (
    <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-aegis-muted text-sm font-medium">{title}</h3>
        <Icon className={\`w-5 h-5 \${color}\`} />
      </div>
      <div className="flex items-baseline space-x-2">
        <span className="text-2xl font-bold">{value}</span>
        <span className={\`text-xs font-medium \${isPositive ? 'text-aegis-red' : 'text-aegis-green'}\`}>
          {isPositive ? '+' : ''}{trend}%
        </span>
      </div>
      {trendLabel && (
        <div className="text-xs text-aegis-muted mt-1">{trendLabel}</div>
      )}
    </div>
  );
}
