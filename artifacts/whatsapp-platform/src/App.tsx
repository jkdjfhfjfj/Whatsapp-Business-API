import { useEffect, useState } from 'react';
import { Switch, Route, Redirect, Link, useLocation } from 'wouter';
import { MessageCircle, BarChart2, Settings as SettingsIcon, Moon, Sun, WifiOff, Radio } from 'lucide-react';
import { api } from './api';
import { useTheme } from './useTheme';
import { useConnectionStatus } from './useConnectionStatus';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';

type User = { id: string; name: string; email: string; role: string; businessId: string };

// Authentication has been removed: there is no login/signup, and nothing below gates access on
// whether a "user" is present. /api/auth/me now always resolves to the one default tenant (see
// server/src/services/defaultTenant.ts) rather than ever returning 401 — this fetch is only to
// get that tenant's businessId/name for display, not to check whether access is allowed. Anyone
// who can reach this URL has full access to every conversation, customer media, and setting.
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userError, setUserError] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const online = useConnectionStatus();
  const [location] = useLocation();

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => { setUser(null); setUserError(true); });
  }, []);

  if (!user) {
    return (
      <div className="center-screen">
        {userError ? (
          <div className="empty-state"><strong>Workspace unavailable</strong><p className="subtext">We could not reach the support workspace.</p><button className="primary-action" onClick={() => window.location.reload()}>Retry</button></div>
        ) : 'Loading workspace'}
      </div>
    );
  }

  const navItems = [
    { to: '/inbox', label: 'Chats', icon: MessageCircle },
    { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="app-shell">
      {!online && (
        <div className="connection-banner">
          <WifiOff size={14} /> Can't reach the server — actions won't save until this reconnects.
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Support workspace
        </div>
        <nav className="desktop-nav">
          {navItems.map(({ to, label }) => (
            <Link key={to} className={location.startsWith(to) ? 'active' : ''} href={to}>{label}</Link>
          ))}
        </nav>
        <div className="user-menu">
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
           <Radio size={14} color="var(--wa-lime)" aria-label="Live connection" />
           <span className="user-name">{user.name}</span>
        </div>
      </header>

      <main>
        <Switch>
          <Route path="/inbox">{() => <Inbox businessId={user.businessId} />}</Route>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/settings/:tab" component={Settings} />
          <Route path="/settings" component={Settings} />
          <Route><Redirect to="/inbox" /></Route>
        </Switch>
      </main>

      <nav className="bottom-nav">
         {navItems.map(({ to, label, icon: Icon }) => (
           <Link key={to} className={location.startsWith(to) ? 'active' : ''} href={to}>
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
