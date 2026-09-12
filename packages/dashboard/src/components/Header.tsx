import React from 'react';
import { Bell, User } from 'lucide-react';

export default function Header() {
  return (
    <header className="h-16 bg-aegis-panel border-b border-gray-800 flex items-center justify-between px-6">
      <div className="text-sm text-aegis-muted">
        Mode: <span className="text-aegis-green font-semibold">Enforce</span>
      </div>
      <div className="flex items-center space-x-4">
        <button className="text-aegis-muted hover:text-white transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-0 right-0 w-2 h-2 bg-aegis-red rounded-full"></span>
        </button>
        <div className="flex items-center space-x-2 text-sm">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
          <span>Admin</span>
        </div>
      </div>
    </header>
  );
}
