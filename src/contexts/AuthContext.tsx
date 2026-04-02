import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { AppRole } from '../lib/rbac';
import { supabase, withSupabaseTimeout } from '../lib/supabase';

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

const FOCUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    isLoading: true,
    error: null,
  });
  const stateRef = useRef(state);
  const lastRoleRefreshAtRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isTransientAuthError = (error: unknown) => {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('failed to fetch')
    );
  };

  const getTenantActivationState = useCallback(async (user: User) => {
    const tenantRows: Array<{ id: string; is_active?: boolean | null; end_date?: string | null }> = [];
    const tenantQueries = [
      supabase
        .from('tenants')
        .select('id, is_active, end_date')
        .eq('user_id', user.id),
    ];

    if (user.email) {
      tenantQueries.push(
        supabase
          .from('tenants')
          .select('id, is_active, end_date')
          .eq('email', user.email.toLowerCase()),
      );
    }

    for (const tenantQuery of tenantQueries) {
      const response = await withSupabaseTimeout(
        tenantQuery,
        'Tenant access check timed out. Please try again.',
      );
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
      let { data, error } = await withSupabaseTimeout(
        supabase
          .from('users')
          .select('role, is_active')
          .eq('id', user.id)
          .single(),
        'Role check timed out. Please try again.',
      );

      if (error?.code === '42703') {
        const fallbackResponse = await withSupabaseTimeout(
          supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single(),
          'Role check timed out. Please try again.',
        );
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
      lastRoleRefreshAtRef.current = Date.now();
    } catch (err) {
      console.error('Error fetching user role:', err);
      if (isTransientAuthError(err)) {
        const currentState = stateRef.current;
        if (currentState.user?.id === user.id && currentState.role) {
          setState({
            user: currentState.user,
            role: currentState.role,
            isLoading: false,
            error: null,
          });
          return;
        }

        setState({
          user,
          role: currentState.role,
          isLoading: false,
          error: 'We could not refresh your account details right now. Please try again in a moment.',
        });
        return;
      }

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
      const { data: { session } } = await withSupabaseTimeout(
        supabase.auth.getSession(),
        'Session check timed out. Please refresh and try again.',
      );
      
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
    }).catch((error) => {
      console.error('Session bootstrap error:', error);
      setState({
        user: null,
        role: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unable to restore your session.',
      });
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [fetchUserRole]);

  useEffect(() => {
    const rehydrate = async () => {
      try {
        const { data: { session } } = await withSupabaseTimeout(
          supabase.auth.getSession(),
          'Session refresh timed out. Please try again.',
        );
        if (session?.user) {
          await fetchUserRole(session.user);
        }
      } catch (error) {
        console.error('Session rehydrate error:', error);
      }
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastRoleRefreshAtRef.current > FOCUS_REFRESH_INTERVAL_MS
      ) {
        void rehydrate();
      }
    };

    const handleOnline = () => {
      void rehydrate();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [fetchUserRole]);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
