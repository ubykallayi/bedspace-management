import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminPropertyProvider } from './contexts/AdminPropertyContext';
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
import { Users as AdminUsers } from './pages/admin/Users';
import { TenantDashboard } from './pages/tenant/Dashboard';
import { Unauthorized } from './pages/Unauthorized';
import { AppRole, getDefaultRouteForRole } from './lib/rbac';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: AppRole[] }) => {
  const { user, role, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (!role) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{
          from: location.pathname,
          redirectTo: getDefaultRouteForRole(role),
          message: `This page is only available for ${allowedRoles.join(', ')} users.`,
        }}
      />
    );
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
      <Route path="/unauthorized" element={<Unauthorized />} />
      
      {/* Admin Routes */}
      <Route path="/admin/*" element={
        <ProtectedRoute allowedRoles={['super_admin', 'owner', 'manager']}>
          <AppLayout>
            <Routes>
              <Route path="/" element={<ProtectedRoute allowedRoles={['super_admin', 'owner', 'manager']}><AdminDashboard /></ProtectedRoute>} />
              <Route path="/rooms" element={<ProtectedRoute allowedRoles={['super_admin', 'owner']}><AdminRooms /></ProtectedRoute>} />
              <Route path="/tenants" element={<ProtectedRoute allowedRoles={['super_admin', 'owner', 'manager']}><AdminTenants /></ProtectedRoute>} />
              <Route path="/payments" element={<ProtectedRoute allowedRoles={['super_admin', 'owner', 'manager']}><AdminPayments /></ProtectedRoute>} />
              <Route path="/expenses" element={<ProtectedRoute allowedRoles={['super_admin', 'owner', 'manager']}><AdminExpenses /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute allowedRoles={['super_admin']}><AdminUsers /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute allowedRoles={['super_admin']}><AdminSettings /></ProtectedRoute>} />
            </Routes>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Tenant Routes */}
      <Route path="/tenant/*" element={
        <ProtectedRoute allowedRoles={['tenant']}>
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
          <Navigate to={getDefaultRouteForRole(role)} replace />
        ) : (
          <Navigate to="/login" replace />
        )
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AppSettingsProvider>
      <AuthProvider>
        <AdminPropertyProvider>
          <Router>
            <AppRoutes />
          </Router>
        </AdminPropertyProvider>
      </AuthProvider>
    </AppSettingsProvider>
  );
}

export default App;
