import Link from 'next/link';
import { ShieldCheck, BookOpen, MessageSquare, Award, ArrowRight, UserCheck, Lock } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-emerald-950 text-white selection:bg-emerald-500 selection:text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-600/30">
              🏏
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight">Cricket Coach AI</span>
              <span className="hidden sm:inline-block ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">RAG Knowledge Base</span>
            </div>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors px-3 py-2"
            >
              Sign In
            </Link>
            <Link
              href="/join"
              className="text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-2"
            >
              Join Academy
            </Link>
            <Link
              href="/signup"
              className="text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-md shadow-emerald-700/20 transition-all hover:scale-[1.02]"
            >
              Create an Academy
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-6">
          <ShieldCheck className="w-4 h-4" />
          <span>Strict Domain-Restricted RAG</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-tight sm:leading-none">
          Coaching Intelligence, Grounded in <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">Your Academy's Knowledge</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
          A private, multi-tenant AI coaching assistant for cricket academies. Answers exclusively from verified coach-uploaded documents, research, and technique drills.
        </p>

        {/* Dual Onboarding Paths */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/signup"
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-7 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-base shadow-xl shadow-emerald-900/40 transition-all hover:scale-[1.02]"
          >
            <span>Create an Academy (Coach)</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/join"
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-7 py-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-emerald-500/30 text-emerald-300 font-semibold text-base transition-all hover:scale-[1.02]"
          >
            <span>Join an Academy (Member)</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="mt-4">
          <span className="text-xs text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="text-emerald-400 hover:underline font-medium">
              Sign In here
            </Link>
          </span>
        </div>

        {/* Feature Highlights Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Zero Hallucination Guardrail</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              If technique information is not in the coach's uploaded materials or the question is outside cricket, the bot strictly declines.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-4">
              <BookOpen className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Coach Document Management</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Upload batting biomechanics, bowling analysis, fielding guides, and academy drills. Processed locally into dense vector chunks.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
              <UserCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Invite-Only Academy Members</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Coaches share unique invite codes. Prospective players register and wait for coach approval before accessing private chat.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
