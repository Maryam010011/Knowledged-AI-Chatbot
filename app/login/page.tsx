'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ArrowRight, AlertCircle, Mail, Key } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isMagicLink, setIsMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      if (isMagicLink) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (otpError) {
          const isEmailProviderIssue =
            otpError.message.toLowerCase().includes('email') ||
            otpError.message.toLowerCase().includes('magic link') ||
            (otpError as any).status === 500;
          if (isEmailProviderIssue) {
            throw new Error(
              `Magic Link delivery error: Supabase email service is currently rate-limited or requires custom SMTP setup in the Supabase Dashboard. Please use Password sign-in instead.`
            );
          }
          throw new Error(`Magic link error: ${otpError.message}`);
        }
        setMagicLinkSent(true);
        return;
      }

      // Password sign-in
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;
      if (!data.user) throw new Error('Sign-in failed. No user returned.');

      // Check user profile role
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, organization_id')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('Profile fetch error during login:', profileError);
      }

      if (profile?.role === 'admin') {
        router.push('/admin');
      } else if (profile?.role === 'member') {
        // Check invite request status for member
        const { data: req } = await supabase
          .from('invite_requests')
          .select('status')
          .eq('email', data.user.email?.toLowerCase())
          .order('requested_at', { ascending: false })
          .limit(1)
          .single();

        if (req?.status === 'accepted' && profile.organization_id) {
          router.push('/chat');
        } else {
          router.push(`/waiting?email=${encodeURIComponent(data.user.email || '')}`);
        }
      } else {
        // Fallback: check if user has a pending invite request
        const { data: req } = await supabase
          .from('invite_requests')
          .select('status')
          .eq('email', data.user.email?.toLowerCase())
          .order('requested_at', { ascending: false })
          .limit(1)
          .single();

        if (req?.status === 'accepted' && profile?.organization_id) {
          router.push('/chat');
        } else {
          router.push(`/waiting?email=${encodeURIComponent(data.user.email || '')}`);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-emerald-600 items-center justify-center text-2xl shadow-lg shadow-emerald-600/30 mb-4">
          🏏
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight">Sign In to Academy</h2>
        <p className="mt-2 text-sm text-slate-400">
          Access coach management or your cricket knowledge assistant
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900/90 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-white/10 backdrop-blur-sm">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {magicLinkSent ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Check your email</h3>
              <p className="text-sm text-slate-300">
                We sent a magic sign-in link to <strong className="text-emerald-400">{email}</strong>.
              </p>
              <button
                type="button"
                onClick={() => setMagicLinkSent(false)}
                className="mt-6 text-xs text-emerald-400 hover:underline cursor-pointer"
              >
                Use a different email or password
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
                />
              </div>

              {!isMagicLink && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsMagicLink(true)}
                      className="text-xs text-emerald-400 hover:underline cursor-pointer"
                    >
                      Sign in with Magic Link instead
                    </button>
                  </div>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
                  />
                </div>
              )}

              {isMagicLink && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => setIsMagicLink(false)}
                    className="text-xs text-emerald-400 hover:underline cursor-pointer"
                  >
                    Sign in with Password instead
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-emerald-700/20 transition-all cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>{isMagicLink ? 'Send Magic Link' : 'Sign In'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-xs text-slate-400 space-y-2">
            <div>
              Coach setting up a new academy?{' '}
              <Link href="/signup" className="text-emerald-400 hover:underline font-medium">
                Create Academy
              </Link>
            </div>
            <div>
              Player invited to join an academy?{' '}
              <Link href="/join" className="text-emerald-400 hover:underline font-medium">
                Join with Invite Code
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
