'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  BookOpen,
  UserCheck,
  History,
  Users,
  Link2,
  Upload,
  Trash2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  LogOut,
  MessageSquare,
  ShieldCheck,
  FileText
} from 'lucide-react';

export default function AdminDashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'documents' | 'pending' | 'history' | 'members' | 'invite'>('documents');
  const [loading, setLoading] = useState(true);
  const [coachProfile, setCoachProfile] = useState<any>(null);

  // Documents state
  const [documents, setDocuments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Invites state
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [inviteHistory, setInviteHistory] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'accepted' | 'rejected'>('all');
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null);

  // Members state
  const [members, setMembers] = useState<any[]>([]);

  // Invite code state
  const [organization, setOrganization] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);

  // Load initial dashboard data
  useEffect(() => {
    async function loadInitial() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, organization_id, full_name, organizations(name, invite_code)')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'admin') {
        router.push('/chat');
        return;
      }

      setCoachProfile(profile);
      await Promise.all([
        fetchDocuments(),
        fetchPendingRequests(),
        fetchInviteHistory(),
        fetchMembers(),
        fetchOrgDetails(),
      ]);
      setLoading(false);
    }

    loadInitial();
  }, [router]);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPendingRequests = async () => {
    try {
      const res = await fetch('/api/admin/invites?status=pending');
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.requests || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchInviteHistory = async () => {
    try {
      const res = await fetch('/api/admin/invites?status=history');
      if (res.ok) {
        const data = await res.json();
        setInviteHistory(data.requests || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMembers = async () => {
    try {
      const res = await fetch('/api/admin/members');
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchOrgDetails = async () => {
    try {
      const res = await fetch('/api/admin/invite-code');
      if (res.ok) {
        const data = await res.json();
        setOrganization(data.organization);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // PDF Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Please select a valid PDF document.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process document');
      }

      await fetchDocuments();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'Upload error');
    } finally {
      setUploading(false);
    }
  };

  // Delete Document
  const handleDeleteDocument = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This will remove all its coaching knowledge chunks.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDocuments(documents.filter((d) => d.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Accept / Reject Invite
  const handleInviteAction = async (requestId: string, action: 'accept' | 'reject') => {
    setProcessingInviteId(requestId);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      });

      if (res.ok) {
        await Promise.all([
          fetchPendingRequests(),
          fetchInviteHistory(),
          fetchMembers(),
        ]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProcessingInviteId(null);
    }
  };

  // Regenerate Invite Code
  const handleRegenerateCode = async () => {
    if (!confirm('Regenerating this code will invalidate any previously distributed invite links. Continue?')) {
      return;
    }

    setRegeneratingCode(true);
    try {
      const res = await fetch('/api/admin/invite-code', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setOrganization((prev: any) => ({ ...prev, invite_code: data.invite_code }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRegeneratingCode(false);
    }
  };

  const copyInviteLink = () => {
    if (!organization?.invite_code) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullLink = `${origin}/join/${organization.invite_code}`;
    navigator.clipboard.writeText(fullLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center space-x-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span>Loading Coach Dashboard...</span>
        </div>
      </div>
    );
  }

  const academyName = organization?.name || coachProfile?.organizations?.name || 'Cricket Academy';
  const inviteLink = typeof window !== 'undefined' && organization?.invite_code
    ? `${window.location.origin}/join/${organization.invite_code}`
    : '';

  const filteredHistory = inviteHistory.filter((item) => {
    if (historyFilter === 'all') return true;
    return item.status === historyFilter;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top Navigation */}
      <header className="border-b border-white/10 bg-slate-900/60 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center font-bold text-white shadow-md shadow-emerald-700/30">
              🏏
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-base sm:text-lg">{academyName}</h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Coach Admin
                </span>
              </div>
              <p className="text-xs text-slate-400">Knowledge Base & Member Manager</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href="/chat"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-emerald-400 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Test RAG Chatbot</span>
            </Link>

            <button
              onClick={handleSignOut}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 hover:text-rose-300 border border-white/10 text-xs font-medium text-slate-300 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap border-b border-white/10 gap-2 mb-8">
          <button
            onClick={() => setActiveTab('documents')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'documents'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Knowledge Documents</span>
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-slate-800 text-slate-300 border border-white/10">
              {documents.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'pending'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Pending Requests</span>
            {pendingRequests.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                {pendingRequests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Request History</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'members'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Academy Members</span>
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-slate-800 text-slate-300 border border-white/10">
              {members.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('invite')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'invite'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>Invite Link</span>
          </button>
        </div>

        {/* TAB 1: DOCUMENTS */}
        {activeTab === 'documents' && (
          <div className="space-y-6">
            {/* Upload Area */}
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                    <Upload className="w-5 h-5 text-emerald-400" />
                    <span>Upload Coaching Materials</span>
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Upload cricket coaching PDFs, biomechanics research, or technique manuals. They are converted to dense vector chunks for domain-restricted retrieval.
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,application/pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm shadow-md shadow-emerald-700/20 cursor-pointer transition-all"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Extracting & Embedding PDF...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span>Select PDF to Ingest</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {uploadError && (
                <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>

            {/* Documents List */}
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-200">
                  Uploaded Knowledge Base ({documents.length})
                </h3>
                <button
                  onClick={fetchDocuments}
                  className="text-xs text-slate-400 hover:text-emerald-400 inline-flex items-center space-x-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>

              {documents.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm font-medium">No coaching documents uploaded yet.</p>
                  <p className="text-slate-500 text-xs mt-1">Upload PDF articles or coaching manuals to populate the AI knowledge base.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {documents.map((doc) => (
                    <div key={doc.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-start space-x-3 max-w-xl">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-white tracking-tight">{doc.title}</h4>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                            <span>Uploaded: {new Date(doc.created_at).toLocaleDateString()}</span>
                            <span>•</span>
                            <span className="text-emerald-400 font-mono font-medium">{doc.chunkCount} vector chunks</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${
                            doc.status === 'ready'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : doc.status === 'processing'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {doc.status}
                        </span>

                        <button
                          onClick={() => handleDeleteDocument(doc.id, doc.title)}
                          title="Delete document and chunks"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: PENDING REQUESTS */}
        {activeTab === 'pending' && (
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-slate-200">Pending Join Requests</h3>
                <p className="text-xs text-slate-400">Review prospective players requesting access to your coaching chatbot</p>
              </div>
              <button
                onClick={fetchPendingRequests}
                className="text-xs text-slate-400 hover:text-emerald-400 inline-flex items-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            {pendingRequests.length === 0 ? (
              <div className="p-12 text-center">
                <UserCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm font-medium">No pending join requests.</p>
                <p className="text-slate-500 text-xs mt-1">Share your academy invite link to allow members to request access.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02]">
                    <div>
                      <h4 className="text-sm font-bold text-white">{req.full_name || 'Anonymous Player'}</h4>
                      <p className="text-xs text-emerald-400 font-mono mt-0.5">{req.email}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Requested: {new Date(req.requested_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => handleInviteAction(req.id, 'accept')}
                        disabled={processingInviteId === req.id}
                        className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-700/20 cursor-pointer transition-all"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>Accept Member</span>
                      </button>

                      <button
                        onClick={() => handleInviteAction(req.id, 'reject')}
                        disabled={processingInviteId === req.id}
                        className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-600 hover:text-white disabled:opacity-50 text-slate-300 text-xs font-semibold border border-white/10 cursor-pointer transition-all"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: REQUEST HISTORY */}
        {activeTab === 'history' && (
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm text-slate-200">Invite Request History</h3>
                <p className="text-xs text-slate-400">Complete audit log of past accepted and rejected requests</p>
              </div>

              {/* Filter pills */}
              <div className="flex items-center space-x-2">
                {(['all', 'accepted', 'rejected'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                      historyFilter === f
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                No past request history found.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredHistory.map((item) => (
                  <div key={item.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-white/[0.02]">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{item.full_name || 'Anonymous Player'}</h4>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{item.email}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Reviewed: {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>

                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                        item.status === 'accepted'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MEMBERS */}
        {activeTab === 'members' && (
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-slate-200">Active Academy Members ({members.length})</h3>
                <p className="text-xs text-slate-400">Athletes and staff with private chatbot conversation access</p>
              </div>
              <button
                onClick={fetchMembers}
                className="text-xs text-slate-400 hover:text-emerald-400 inline-flex items-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            {members.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                No members found in this academy yet.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {members.map((member) => (
                  <div key={member.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-white/[0.02]">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-sm font-semibold text-white">{member.full_name}</h4>
                        <span
                          className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            member.role === 'admin'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300 border border-white/10'
                          }`}
                        >
                          {member.role}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{member.email}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-emerald-400 font-medium">
                        {member.conversationCount} conversation{member.conversationCount === 1 ? '' : 's'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Joined {new Date(member.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: INVITE LINK */}
        {activeTab === 'invite' && (
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm max-w-3xl">
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <Link2 className="w-5 h-5 text-emerald-400" />
              <span>Academy Invite Link</span>
            </h3>
            <p className="text-sm text-slate-400 mt-1 leading-relaxed">
              Share this dedicated join link with your cricket players. When they submit a join request, you'll see them in your <strong>Pending Requests</strong> tab for one-click approval.
            </p>

            <div className="mt-6">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Active Member Join URL
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="w-full px-4 py-2.5 bg-slate-800/80 border border-white/10 rounded-xl text-emerald-400 font-mono text-sm focus:outline-none select-all"
                />
                <button
                  onClick={copyInviteLink}
                  className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all flex-shrink-0 cursor-pointer"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-rose-300">Regenerate Invite Code</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Creates a new random 8-character code and immediately invalidates the old link.
                </p>
              </div>
              <button
                onClick={handleRegenerateCode}
                disabled={regeneratingCode}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer"
              >
                {regeneratingCode ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Regenerating...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Regenerate Code</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
