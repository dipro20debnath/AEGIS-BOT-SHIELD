import React from 'react';
import RequestTable from '../components/RequestTable';

const mockLogs = [
  { id: '1', time: '2023-10-27 10:42:01', ip: '192.168.1.1', path: '/login', threatType: 'OAT-001', action: 'blocked' as const },
  { id: '2', time: '2023-10-27 10:42:05', ip: '203.0.113.4', path: '/api/data', threatType: 'OAT-011', action: 'challenged' as const },
  { id: '3', time: '2023-10-27 10:42:10', ip: '10.0.0.5', path: '/', action: 'allowed' as const },
  { id: '4', time: '2023-10-27 10:42:15', ip: '192.168.1.2', path: '/register', action: 'allowed' as const },
  { id: '5', time: '2023-10-27 10:42:20', ip: '8.8.8.8', path: '/graphql', threatType: 'SQLi', action: 'blocked' as const },
];

export default function Logs() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Request Logs</h1>
        <button className="border border-gray-600 text-gray-300 px-3 py-1 rounded text-sm hover:bg-gray-800">
          Export CSV
        </button>
      </div>
      
      <div className="bg-aegis-panel p-4 rounded-lg border border-gray-800 flex space-x-4 mb-4">
        <input 
          type="text" 
          placeholder="Search IP, Path..." 
          className="bg-gray-900 border border-gray-700 rounded p-2 text-white flex-1 focus:border-aegis-blue focus:outline-none text-sm"
        />
        <select className="bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-aegis-blue focus:outline-none text-sm">
          <option>All Actions</option>
          <option>Blocked</option>
          <option>Challenged</option>
          <option>Allowed</option>
        </select>
      </div>

      <div className="bg-aegis-panel rounded-lg border border-gray-800">
        <RequestTable requests={mockLogs} />
      </div>
    </div>
  );
}
