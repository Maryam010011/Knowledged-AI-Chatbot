'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clock, CheckCircle2, XCircle, RefreshCw, MessageSquare } from 'lucide-react';

function WaitingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email') || '';
  const initialAcademy = searchParams.get('academy') || 'the Academy';

  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected' | 'not_found'>('pending');
  const [checking, setChecking] = useState(false);

  const checkStatus = async () => {
    if (!email) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/auth/request-status?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
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
    checkStatus();
    // Poll every 8 seconds
    const interval = setInterval(checkStatus, 8000);
    return () => clearInterval(interval);
  }, [email]);

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
                Your request to join <strong className="text-white">{initialAcademy}</strong> has been submitted.
              </p>
              <div className="mt-4 p-3 rounded-xl bg-slate-800/80 border border-white/5 text-xs text-slate-400">
                Registered Email: <span className="text-emerald-400 font-mono">{email || 'your email'}</span>
              </div>
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                Once the coach accepts your request, you will immediately gain access to the private coaching knowledge base and chat assistant.
              </p>

              <button
                onClick={checkStatus}
                disabled={checking}
                className="mt-8 inline-flex items-center space-x-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                <span>Check approval status</span>
              </button>
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
                Your coach has approved your membership. Redirecting to coaching chat...
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
                Your request to join this academy was not approved at this time. If you believe this is in error, please contact your coach directly.
              </p>
              <Link
                href="/"
                className="mt-6 inline-block text-xs text-slate-400 hover:text-white underline"
              >
                Return to home
              </Link>
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
