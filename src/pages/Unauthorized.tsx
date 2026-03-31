import { ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { getDefaultRouteForRole } from '../lib/rbac';

export const Unauthorized = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuth();

  const redirectTo = (location.state as { redirectTo?: string; message?: string } | null)?.redirectTo
    ?? getDefaultRouteForRole(role);
  const message = (location.state as { redirectTo?: string; message?: string } | null)?.message
    ?? 'You do not have permission to access this page.';

  return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
      <Card style={{ maxWidth: '520px', width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--warning-bg)' }}>
            <ShieldAlert size={30} color="var(--warning)" />
          </div>
        </div>
        <h1 style={{ marginBottom: '0.75rem' }}>Unauthorized</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button onClick={() => navigate(redirectTo, { replace: true })}>Go To My Area</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </Card>
    </div>
  );
};
