import React from 'react';
import ThreatBadge from './ThreatBadge';

interface Request {
  id: string;
  time: string;
  ip: string;
  path: string;
  threatType?: string;
  action: 'allowed' | 'blocked' | 'challenged';
}

interface RequestTableProps {
  requests: Request[];
}

export default function RequestTable({ requests }: RequestTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-800 text-aegis-muted text-sm">
            <th className="py-3 px-4 font-medium">Time</th>
            <th className="py-3 px-4 font-medium">IP Address</th>
            <th className="py-3 px-4 font-medium">Path</th>
            <th className="py-3 px-4 font-medium">Threat</th>
            <th className="py-3 px-4 font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {requests.map((req) => (
            <tr key={req.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
              <td className="py-3 px-4 text-aegis-muted">{req.time}</td>
              <td className="py-3 px-4 font-mono">{req.ip}</td>
              <td className="py-3 px-4 text-gray-300">{req.path}</td>
              <td className="py-3 px-4">
                {req.threatType ? <ThreatBadge type={req.threatType} /> : <span className="text-gray-500">-</span>}
              </td>
              <td className="py-3 px-4">
                <span className={\`px-2 py-1 rounded text-xs font-medium \${
                  req.action === 'blocked' ? 'text-red-400 bg-red-400/10' :
                  req.action === 'allowed' ? 'text-green-400 bg-green-400/10' :
                  'text-yellow-400 bg-yellow-400/10'
                }\`}>
                  {req.action.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
