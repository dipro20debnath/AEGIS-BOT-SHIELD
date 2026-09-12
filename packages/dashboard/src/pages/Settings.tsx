import React from 'react';

export default function Settings() {
  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Configuration</h1>
      
      <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Protection Mode</h2>
        <div className="space-y-4">
          <label className="flex items-center space-x-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-800/50">
            <input type="radio" name="mode" className="text-aegis-blue focus:ring-aegis-blue bg-gray-900 border-gray-700" />
            <div>
              <div className="font-medium">Monitor Mode</div>
              <div className="text-sm text-aegis-muted">Log threats but do not block traffic.</div>
            </div>
          </label>
          <label className="flex items-center space-x-3 p-3 border border-aegis-green/30 bg-aegis-green/5 rounded cursor-pointer">
            <input type="radio" name="mode" defaultChecked className="text-aegis-green focus:ring-aegis-green bg-gray-900 border-gray-700" />
            <div>
              <div className="font-medium text-aegis-green">Enforce Mode (Recommended)</div>
              <div className="text-sm text-aegis-muted">Block high-risk bots and challenge suspicious traffic.</div>
            </div>
          </label>
          <label className="flex items-center space-x-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-800/50">
            <input type="radio" name="mode" className="text-red-500 focus:ring-red-500 bg-gray-900 border-gray-700" />
            <div>
              <div className="font-medium text-red-400">Strict Mode</div>
              <div className="text-sm text-aegis-muted">Block all suspicious traffic. May impact legitimate users.</div>
            </div>
          </label>
        </div>
      </div>

      <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Rate Limiting</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Max Requests</label>
            <input type="number" defaultValue={100} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-aegis-blue focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Window (seconds)</label>
            <input type="number" defaultValue={60} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-aegis-blue focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button className="bg-aegis-blue text-white px-4 py-2 rounded font-medium hover:bg-blue-600 transition-colors">
          Save Changes
        </button>
      </div>
    </div>
  );
}
