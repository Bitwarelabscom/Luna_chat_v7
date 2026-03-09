'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { createApi } from '@/lib/api/create';
import { Moon, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/chat';
  const { login, checkAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (showRegister) {
        await createApi.registerWithInvite(inviteCode, email, password, displayName);
        await checkAuth();
        router.push(redirect);
      } else {
        await login(email, password);
        router.push(redirect);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-theme-bg-primary">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-theme-accent-primary mb-4">
            <Moon className="w-8 h-8 text-theme-text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Welcome to Luna</h1>
          <p className="text-theme-text-muted mt-2">
            {showRegister ? 'Create an account with your invite code' : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {showRegister && (
            <>
              <div>
                <label htmlFor="inviteCode" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Invite Code
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-lg focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent outline-none transition text-theme-text-primary placeholder-theme-text-muted"
                  placeholder="Enter your invite code"
                  required
                />
              </div>
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-lg focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent outline-none transition text-theme-text-primary placeholder-theme-text-muted"
                  placeholder="Your name"
                  required
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-lg focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent outline-none transition text-theme-text-primary placeholder-theme-text-muted"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-lg focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent outline-none transition pr-12 text-theme-text-primary placeholder-theme-text-muted"
                placeholder={showRegister ? 'Choose a password (min 8 chars)' : 'Enter your password'}
                required
                minLength={showRegister ? 8 : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-secondary"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-theme-accent-primary hover:bg-theme-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition flex items-center justify-center gap-2 text-theme-text-primary"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {showRegister ? 'Creating account...' : 'Signing in...'}
              </>
            ) : (
              showRegister ? 'Create Account' : 'Sign in'
            )}
          </button>
        </form>

        <div className="text-center mt-4">
          <button
            onClick={() => { setShowRegister(!showRegister); setError(''); }}
            className="text-sm text-theme-accent-primary hover:underline"
          >
            {showRegister ? 'Already have an account? Sign in' : 'Have an invite code? Create account'}
          </button>
        </div>

      </div>
    </div>
  );
}
