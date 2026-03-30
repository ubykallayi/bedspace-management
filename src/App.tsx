import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Login } from './pages/Login';

import { Dashboard as AdminDashboard } from './pages/admin/Dashboard';
import { Expenses as AdminExpenses } from './pages/admin/Expenses';
import { Rooms as AdminRooms } from './pages/admin/Rooms';
import { Tenants as AdminTenants } from './pages/admin/Tenants';
import { Payments as AdminPayments } from './pages/admin/Payments';
import { Settings as AdminSettings } from './pages/admin/Settings';
import { TenantDashboard } from './pages/tenant/Dashboard';

const ProtectedRoute = ({ children, allowedRole }: { children: React.ReactNode, allowedRole?: 'admin' | 'tenant' }) => {
  const { user, role, isLoading } = useAuth();

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (!role) return <Navigate to="/login" replace />;
  if (allowedRole && role && role !== allowedRole) {
    return <Navigate to={role === 'admin' ? '/admin' : '/tenant'} />;
  }

  return <>{children}</>;
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-container">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="main-content relative bg-texture">
        <Topbar onMenuToggle={() => setIsSidebarOpen((value) => !value)} />
        
        {/* Base decorative blurred glow behind the content */}
        <div style={{
          position: 'absolute', top: '-15%', left: '-10%', 
          width: '50%', height: '50%', background: 'var(--primary-glow)',
          filter: 'blur(120px)', zIndex: 0, pointerEvents: 'none'
        }}></div>

        <div style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
};

function AppRoutes() {
  const { user, role } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      
      {/* Admin Routes */}
      <Route path="/admin/*" element={
        <ProtectedRoute allowedRole="admin">
          <AppLayout>
            <Routes>
              <Route path="/" element={<AdminDashboard />} />
              <Route path="/rooms" element={<AdminRooms />} />
              <Route path="/tenants" element={<AdminTenants />} />
              <Route path="/payments" element={<AdminPayments />} />
              <Route path="/expenses" element={<AdminExpenses />} />
              <Route path="/settings" element={<AdminSettings />} />
            </Routes>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Tenant Routes */}
      <Route path="/tenant/*" element={
        <ProtectedRoute allowedRole="tenant">
          <AppLayout>
            <Routes>
              <Route path="/" element={<TenantDashboard />} />
            </Routes>
          </AppLayout>
        </ProtectedRoute>
      } />
      
      {/* Root redirect */}
      <Route path="/" element={
        user ? (
          <Navigate to={role === 'admin' ? '/admin' : '/tenant'} replace />
        ) : (
          <Navigate to="/login" replace />
        )
      } />
    </Routes>
  );
}

function App() {
  return (
    <AppSettingsProvider>
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </AppSettingsProvider>
  );
}

export default App;
