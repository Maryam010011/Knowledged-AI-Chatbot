'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function JoinPage() {
  const router = useRouter();

  const [inviteCode, setInviteCode] = useState('');
  const [academyName, setAcademyName] = useState<string | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyInviteCode = async (codeToVerify: string) => {
    const code = codeToVerify.trim();
    if (!code) return;
    setVerifyingCode(true);
    setError(null);

    try {
      const res = await fetch(`/api/academy/${code}`);
      const data = await res.json();
      if (!res.ok || !data.name) {
        throw new Error(data.error || 'Invalid or expired invite code');
      }
      setAcademyName(data.name);
      setCodeVerified(true);
    } catch (err: any) {
      setError(err.message || 'Academy not found with this code');
      setCodeVerified(false);
      setAcademyName(null);
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const cleanCode = inviteCode.trim();
      if (!cleanCode) throw new Error('Invite code is required.');

      const res = await fetch('/api/auth/join-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: cleanCode,
          email,
          fullName,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit membership request');
      }

      // If user registered with password, log them in to establish session
      if (password) {
        const supabase = createClient();
        await supabase.auth.signInWithPassword({ email, password }).catch(() => {});
      }

      router.push(`/waiting?email=${encodeURIComponent(email)}&academy=${encodeURIComponent(academyName || data.organizationName || '')}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-emerald-600 items-center justify-center text-2xl shadow-lg shadow-emerald-600/30 mb-4">
          🏏
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight">Join an Academy</h2>
        <p className="mt-2 text-sm text-slate-400">
          Enter your coach's invite code to request academy membership and access private AI coaching knowledge.
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

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Academy Invite Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="e.g., oxu18eji"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value);
                    setCodeVerified(false);
                  }}
                  className="flex-1 px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all uppercase tracking-wider font-mono"
                />
                <button
                  type="button"
                  onClick={() => verifyInviteCode(inviteCode)}
                  disabled={verifyingCode || !inviteCode.trim()}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-xs font-semibold text-emerald-400 border border-white/10 cursor-pointer"
                >
                  {verifyingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                </button>
              </div>

              {codeVerified && academyName && (
                <div className="mt-2 flex items-center space-x-2 text-xs text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verified: <strong>{academyName}</strong></span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Player Full Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Joe Root"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="player@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-4 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-emerald-700/20 transition-all cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting Request...</span>
                </>
              ) : (
                <>
                  <span>Request Academy Membership</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-white/10 text-center space-y-2 text-xs text-slate-400">
            <div>
              Already an approved member?{' '}
              <Link href="/login" className="text-emerald-400 hover:underline font-medium">
                Sign In
              </Link>
            </div>
            <div>
              Are you a coach looking to create an academy?{' '}
              <Link href="/signup" className="text-emerald-400 hover:underline font-medium">
                Create an Academy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
