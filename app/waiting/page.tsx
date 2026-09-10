'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Clock, CheckCircle2, XCircle, RefreshCw, MessageSquare, LogOut } from 'lucide-react';

function WaitingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [academyName, setAcademyName] = useState(searchParams.get('academy') || '');
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected' | 'not_found'>('pending');
  const [checking, setChecking] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);

  // 1. Resolve user session & email if missing from searchParams
  useEffect(() => {
    async function resolveUserSession() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        if (!email) setEmail(user.email);

        // Fetch request status directly
        try {
          const res = await fetch(`/api/auth/request-status?email=${encodeURIComponent(user.email)}`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data.status);
            if (data.academyName) setAcademyName(data.academyName);
            if (data.status === 'accepted') {
              setTimeout(() => {
                router.push('/chat');
              }, 1500);
            }
          }
        } catch (e) {
          console.error('Request status fetch error:', e);
        }
      }
      setLoadingSession(false);
    }

    resolveUserSession();
  }, [email, router]);

  const checkStatus = async () => {
    const targetEmail = email;
    if (!targetEmail) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/auth/request-status?email=${encodeURIComponent(targetEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
        if (data.academyName) setAcademyName(data.academyName);
        if (data.status === 'accepted') {
          setTimeout(() => {
            router.push('/chat');
          }, 1500);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!email) return;
    checkStatus();
    const interval = setInterval(checkStatus, 8000);
    return () => clearInterval(interval);
  }, [email]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const displayAcademy = academyName || 'Cricket Academy';

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900/90 py-10 px-6 shadow-2xl rounded-2xl sm:px-10 border border-white/10 text-center">
          {status === 'pending' && (
            <>
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-6">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">
                Request Sent to Coach
              </h2>
              <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                Your request to join <strong className="text-white">{displayAcademy}</strong> has been submitted.
              </p>
              {email && (
                <div className="mt-4 p-3 rounded-xl bg-slate-800/80 border border-white/5 text-xs text-slate-400">
                  Registered Email: <span className="text-emerald-400 font-mono">{email}</span>
                </div>
              )}
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                Once the coach accepts your request, you will immediately gain access to the private coaching knowledge base and chat assistant.
              </p>

              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  onClick={checkStatus}
                  disabled={checking}
                  className="inline-flex items-center space-x-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                  <span>Check approval status</span>
                </button>

                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </>
          )}

          {status === 'accepted' && (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">
                You're Approved!
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                Your coach has approved your membership to <strong className="text-emerald-400">{displayAcademy}</strong>. Redirecting to coaching chat...
              </p>
              <Link
                href="/chat"
                className="mt-6 inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 shadow-lg shadow-emerald-700/20"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Enter Chat</span>
              </Link>
            </>
          )}

          {status === 'rejected' && (
            <>
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-6">
                <XCircle className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Membership Request Not Approved
              </h2>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                Your request to join <strong className="text-white">{displayAcademy}</strong> was not approved at this time. If you believe this is in error, please contact your coach directly.
              </p>
              <div className="mt-6 flex items-center justify-center gap-4">
                <Link
                  href="/"
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Return to home
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-xs text-rose-400 hover:underline"
                >
                  Sign Out
                </button>
              </div>
            </>
          )}

          {status === 'not_found' && (
            <>
              <div className="w-16 h-16 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-6">
                <Clock className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                No Active Request Found
              </h2>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                We couldn't find a pending join request for your account. Please ask your coach for an invite link.
              </p>
              <div className="mt-6 flex items-center justify-center gap-4">
                <Link
                  href="/"
                  className="text-xs text-emerald-400 hover:underline font-semibold"
                >
                  Return to Homepage
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-xs text-slate-400 hover:text-rose-400"
                >
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WaitingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading status...
      </div>
    }>
      <WaitingContent />
    </Suspense>
  );
}
