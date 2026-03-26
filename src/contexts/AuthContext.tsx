import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthState = {
  user: User | null;
  role: 'admin' | 'tenant' | null;
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
  }, []);

  const fetchUserRole = async (user: User) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
        
      if (error) throw error;
      
      setState({
        user,
        role: data?.role as 'admin' | 'tenant',
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
  };

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
