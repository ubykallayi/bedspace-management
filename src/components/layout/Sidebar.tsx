import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LayoutDashboard, Users, DoorOpen, LogOut, Receipt, Settings as SettingsIcon, Wallet, X } from 'lucide-react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessRooms, canAccessSettings, canManageUsers, isAdminRole } from '../../lib/rbac';

type SidebarProps = {
  isOpen?: boolean;
  onClose?: () => void;
};

export const Sidebar = ({ isOpen = false, onClose }: SidebarProps) => {
  const { role } = useAuth();
  const { settings } = useAppSettings();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose?.();
    navigate('/login');
  };

  const adminLinks = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin/tenants', icon: Users, label: 'Tenants' },
    { to: '/admin/payments', icon: Receipt, label: 'Payments' },
    { to: '/admin/expenses', icon: Wallet, label: 'Expenses' },
  ];
  if (canAccessRooms(role)) {
    adminLinks.splice(1, 0, { to: '/admin/rooms', icon: DoorOpen, label: 'Rooms & Beds' });
  }
  if (canManageUsers(role)) {
    adminLinks.push({ to: '/admin/users', icon: Users, label: 'Users' });
  }
  if (canAccessSettings(role)) {
    adminLinks.push({ to: '/admin/settings', icon: SettingsIcon, label: 'Settings' });
  }

  const tenantLinks = [
    { to: '/tenant', icon: LayoutDashboard, label: 'My Dashboard' },
  ];

  const links = isAdminRole(role) ? adminLinks : tenantLinks;

  return (
    <aside className={`sidebar-shell ${isOpen ? 'is-open' : ''}`}>
      <div className="sidebar-backdrop" onClick={onClose} />
      <div className="sidebar-panel">
      <div style={{ padding: '1.5rem 1.5rem 1.25rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DoorOpen size={28} />
          {settings.site_name}
        </h2>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/admin' || link.to === '/tenant'}
            onClick={onClose}
            className={({ isActive }) => 
              `btn ${isActive ? 'btn-primary' : 'btn-secondary'} rounded`
            }
            style={{ 
              justifyContent: 'flex-start',
              background: 'transparent',
              border: 'none',
              padding: '0.75rem 1rem',
              color: 'var(--text-secondary)'
            }}
          >
            {({ isActive }) => (
              <>
                <link.icon size={20} style={{ color: isActive ? '#fff' : 'var(--text-tertiary)' }} />
                <span style={{ color: isActive ? '#fff' : 'inherit', fontWeight: isActive ? 600 : 400 }}>{link.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '2rem' }}>
        <button 
          onClick={handleLogout}
          className="btn btn-secondary" 
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
      </div>
    </aside>
  );
};
