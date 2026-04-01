import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { AppRole } from '../lib/rbac';
import { supabase } from '../lib/supabase';

type AuthState = {
  user: User | null;
  role: AppRole | null;
  isLoading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  isLoading: true,
  error: null,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    isLoading: true,
    error: null,
  });

  const getTenantActivationState = useCallback(async (user: User) => {
    const tenantRows: Array<{ id: string; is_active?: boolean | null; end_date?: string | null }> = [];
    const tenantQueries = [
      supabase
        .from('tenants')
        .select('id, is_active, end_date')
        .eq('user_id', user.id),
      user.email
        ? supabase
          .from('tenants')
          .select('id, is_active, end_date')
          .eq('email', user.email.toLowerCase())
        : null,
    ].filter(Boolean);

    for (const tenantQuery of tenantQueries) {
      const response = await tenantQuery;
      if (!response) return { blocked: true };
      const { data, error } = response;

      if (error) {
        if (error.code === '42703' || error.code === '42P01') {
          // If the tenants table/columns are not ready yet, fail closed for tenant access.
          return { blocked: true };
        }
        throw error;
      }

      tenantRows.push(...((data ?? []) as Array<{ id: string; is_active?: boolean | null; end_date?: string | null }>));
    }

    const uniqueTenantRows = tenantRows.filter((tenant, index, rows) => (
      rows.findIndex((item) => item.id === tenant.id) === index
    ));

    if (uniqueTenantRows.length === 0) {
      // No tenant booking rows found – treat as not allowed to access tenant portal.
      return { blocked: true };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      blocked: !uniqueTenantRows.some((tenant) => {
        const isManuallyActive = tenant.is_active !== false;
        const isNotExpired = !tenant.end_date || new Date(tenant.end_date) >= today;
        return isManuallyActive && isNotExpired;
      }),
    };
  }, []);

  const fetchUserRole = useCallback(async (user: User) => {
    try {
      let { data, error } = await supabase
        .from('users')
        .select('role, is_active')
        .eq('id', user.id)
        .single();

      if (error?.code === '42703') {
        const fallbackResponse = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single();
        data = fallbackResponse.data ? { ...fallbackResponse.data, is_active: true } : null;
        error = fallbackResponse.error;
      }

      if (error) throw error;

      if (data?.is_active === false) {
        await supabase.auth.signOut();
        setState({
          user: null,
          role: null,
          isLoading: false,
          error: 'Account inactive',
        });
        return;
      }

      if (data?.role === 'tenant') {
        const tenantActivation = await getTenantActivationState(user);
        if (tenantActivation.blocked) {
          await supabase.auth.signOut();
          setState({
            user: null,
            role: null,
            isLoading: false,
            error: 'Your tenant portal access is not active for any booking. Please contact an admin.',
          });
          return;
        }
      }
      
      setState({
        user,
        role: data?.role as AppRole,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error fetching user role:', err);
      await supabase.auth.signOut();
      setState({
        user: null,
        role: null,
        isLoading: false,
        error: 'Your account is signed in, but no valid role is configured yet. Please contact an admin.',
      });
    }
  }, [getTenantActivationState]);

  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        await fetchUserRole(session.user);
      } else {
        setState({ user: null, role: null, isLoading: false, error: null });
      }

      // Listen to auth changes
      const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
        if (newSession?.user) {
          await fetchUserRole(newSession.user);
        } else {
          setState({ user: null, role: null, isLoading: false, error: null });
        }
      });

      return authListener.subscription;
    };

    let subscription: { unsubscribe: () => void } | undefined;

    fetchSession().then((listener) => {
      subscription = listener;
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [fetchUserRole]);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
