import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { DoorOpen } from 'lucide-react';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { useAuth } from '../contexts/AuthContext';

export const Login = () => {
  const { settings } = useAppSettings();
  const { error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      // Navigation handles redirect automatically because of AuthContext changes
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      background: 'radial-gradient(circle at top, var(--bg-card) 0%, var(--bg-main) 100%)'
    }}>
      <div className="animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <DoorOpen size={48} color="var(--primary)" style={{ margin: '0 auto' }} />
          <h1 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>{settings.site_name}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Log in to continue. Tenant and staff accounts are created and activated by an administrator.
          </p>
        </div>

        <Card>
          <form onSubmit={handleAuth}>
            <Input
              label="Email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            
            {(error || authError) && (
              <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.5rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
                {error || authError}
              </div>
            )}

            <Button type="submit" variant="primary" style={{ width: '100%', marginBottom: '1rem' }} isLoading={loading}>
              Log In
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
