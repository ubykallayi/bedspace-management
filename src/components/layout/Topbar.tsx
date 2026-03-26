import { useAuth } from '../../contexts/AuthContext';
import { Menu, User } from 'lucide-react';

type TopbarProps = {
  onMenuToggle?: () => void;
};

export const Topbar = ({ onMenuToggle }: TopbarProps) => {
  const { user, role } = useAuth();

  return (
    <div className="glass-panel topbar-shell" style={{ 
      padding: '0 2rem', 
      height: 'var(--header-height)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button type="button" className="menu-toggle" onClick={onMenuToggle} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <div className="search-bar">
          {/* Can add global search here later */}
        </div>
      </div>

      <div className="topbar-user" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <div className="topbar-email" style={{ fontSize: '0.875rem', fontWeight: 600 }}>{user?.email}</div>
          <div className="badge badge-success" style={{ marginTop: '0.25rem' }}>
            {role || 'Loading...'}
          </div>
        </div>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          borderRadius: '50%', 
          background: 'var(--bg-card)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          border: '1px solid var(--border-light)'
        }}>
          <User size={20} color="var(--text-secondary)" />
        </div>
      </div>
    </div>
  );
};
