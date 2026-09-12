import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, LineChart, ShieldAlert, Settings, FileText, Shield } from 'lucide-react';

export default function Sidebar() {
  const navItems = [
    { name: 'Overview', path: '/', icon: LayoutDashboard },
    { name: 'Analytics', path: '/analytics', icon: LineChart },
    { name: 'Threats', path: '/threats', icon: ShieldAlert },
    { name: 'Logs', path: '/logs', icon: FileText },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="w-64 bg-aegis-panel border-r border-gray-800 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-gray-800">
        <Shield className="text-aegis-green w-8 h-8 mr-2" />
        <span className="text-xl font-bold tracking-wider">AEGIS</span>
      </div>
      <nav className="flex-1 py-4">
        <ul>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.name} className="px-3 mb-1">
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    \`flex items-center px-3 py-2 rounded-md transition-colors \${
                      isActive 
                        ? 'bg-blue-600/20 text-aegis-blue' 
                        : 'text-aegis-muted hover:bg-gray-800 hover:text-white'
                    }\`
                  }
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.name}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
