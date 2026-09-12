import React from 'react';
import ThreatBadge from '../components/ThreatBadge';

const activeThreats = [
  { id: 'T-1001', type: 'OAT-001 Credential Stuffing', severity: 'High', status: 'Blocked', target: '/api/v1/auth/login', count: 12500, time: '10 mins ago' },
  { id: 'T-1002', type: 'OAT-011 Scraping', severity: 'Medium', status: 'Challenged', target: '/products/list', count: 3400, time: '1 hour ago' },
];

export default function Threats() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Active Threats</h1>
      
      <div className="grid gap-4">
        {activeThreats.map(threat => (
          <div key={threat.id} className="bg-aegis-panel p-5 rounded-lg border border-gray-800 flex items-center justify-between hover:border-gray-600 transition-colors cursor-pointer">
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-3">
                <span className="font-mono text-aegis-muted">{threat.id}</span>
                <ThreatBadge type={threat.type} />
                <span className={\`text-xs px-2 py-1 rounded \${threat.severity === 'High' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}\`}>
                  {threat.severity}
                </span>
              </div>
              <div className="text-sm text-gray-300">
                Targeting <span className="font-mono text-gray-400">{threat.target}</span> • {threat.count.toLocaleString()} requests
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-aegis-green mb-1">{threat.status}</div>
              <div className="text-xs text-aegis-muted">{threat.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
