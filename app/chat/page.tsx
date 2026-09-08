'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Send,
  Plus,
  Trash2,
  ShieldCheck,
  BookOpen,
  MessageSquare,
  LogOut,
  Settings,
  ChevronDown,
  Sparkles,
  Loader2,
  FileText,
  AlertCircle
} from 'lucide-react';

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
  similarity?: number;
}

export default function ChatPage() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [loadingUser, setLoadingUser] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [activeSources, setActiveSources] = useState<{ [msgIndex: number]: boolean }>({});

  // 1. Authenticate user & load conversations
  useEffect(() => {
    async function initChat() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role, organization_id, full_name, organizations(name)')
        .eq('id', user.id)
        .single();

      if (!prof?.organization_id) {
        router.push('/waiting');
        return;
      }

      setProfile(prof);
      await fetchConversations();
      setLoadingUser(false);
    }

    initChat();
  }, [router]);

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadConversationMessages = async (id: string) => {
    setCurrentConversationId(id);
    try {
      const res = await fetch(`/api/conversations?id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startNewChat = () => {
    setCurrentConversationId(null);
    setMessages([]);
    if (inputRef.current) inputRef.current.focus();
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/conversations?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConversations(conversations.filter(c => c.id !== id));
        if (currentConversationId === id) {
          startNewChat();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputMessage.trim();
    if (!query || sending) return;

    setInputMessage('');
    const tempUserMsg: ChatMessage = { role: 'user', content: query };
    setMessages(prev => [...prev, tempUserMsg]);
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          conversationId: currentConversationId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Update conversation ID if newly created
      if (!currentConversationId && data.conversationId) {
        setCurrentConversationId(data.conversationId);
        fetchConversations();
      }

      const botMsg: ChatMessage = {
        role: 'assistant',
        content: data.message?.content || '',
        sources: data.sources || [],
        similarity: data.bestSimilarity,
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Error: ${err.message || 'Unable to complete your request. Please try again.'}`
        }
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center space-x-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span>Entering Cricket Coaching Lab...</span>
        </div>
      </div>
    );
  }

  const academyName = profile?.organizations?.name || 'Cricket Academy';

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-72 bg-slate-900 border-r border-white/10 flex flex-col hidden md:flex">
        {/* Academy Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-white shadow-sm">
              🏏
            </div>
            <div>
              <h2 className="text-sm font-bold truncate max-w-[140px]">{academyName}</h2>
              <p className="text-[11px] text-emerald-400 font-medium">Coaching RAG Lab</p>
            </div>
          </div>

          {profile?.role === 'admin' && (
            <Link
              href="/admin"
              title="Coach Dashboard"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </Link>
          )}
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-700/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Coaching Chat</span>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <p className="px-2 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Your Conversations
          </p>

          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-slate-500 italic">No saved chats yet.</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => loadConversationMessages(c.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                  currentConversationId === c.id
                    ? 'bg-emerald-500/10 text-emerald-300 font-medium border border-emerald-500/20'
                    : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{c.title || 'Coaching Query'}</span>
                </div>

                <button
                  onClick={(e) => deleteConversation(e, c.id)}
                  title="Delete chat"
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* User Footer */}
        <div className="p-3 border-t border-white/10 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center space-x-2 truncate">
            <div className="w-7 h-7 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-emerald-400">
              {profile?.full_name ? profile.full_name[0].toUpperCase() : 'U'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-white truncate">{profile?.full_name || 'Member'}</p>
              <span className="text-[10px] text-slate-400 capitalize">{profile?.role}</span>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            title="Sign Out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-14 border-b border-white/10 bg-slate-900/50 backdrop-blur-md px-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="md:hidden font-bold text-sm">🏏 {academyName}</span>
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Grounded in Coach Materials Only</span>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <span className="hidden sm:inline">Engine:</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-white/5">
              Groq (gpt-oss-120b)
            </span>
          </div>
        </header>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-3xl mx-auto mb-4 shadow-xl shadow-emerald-900/30">
                🏏
              </div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight">
                Cricket Coaching Assistant
              </h2>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed max-w-lg mx-auto">
                Ask questions about batting footwork, bowling biomechanics, fielding drills, and fitness. Answers are retrieved strictly from <strong className="text-white">{academyName}</strong>'s uploaded documents.
              </p>

              {/* Sample Prompts */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                {[
                  "What is the recommended head and front-foot position for the forward defensive?",
                  "How does the kinetic chain transfer energy in fast bowling biomechanics?",
                  "What coaching drills help correct a batsman playing with a closed bat face?",
                  "Explain the role of video feedback and technology in modern cricket coaching."
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInputMessage(prompt);
                      if (inputRef.current) inputRef.current.focus();
                    }}
                    className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/5 hover:border-emerald-500/30 text-xs text-slate-300 transition-all text-left group"
                  >
                    <div className="flex items-start space-x-2">
                      <Sparkles className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0 group-hover:scale-110 transition-transform" />
                      <span>{prompt}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-2xl p-4 sm:p-5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-700/10'
                      : 'bg-slate-900/90 border border-white/10 text-slate-200 shadow-lg backdrop-blur-sm'
                  }`}
                >
                  {/* Message content */}
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Retrieved Sources & Grounding Details */}
                  {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-white/10">
                      <button
                        onClick={() =>
                          setActiveSources(prev => ({ ...prev, [index]: !prev[index] }))
                        }
                        className="inline-flex items-center space-x-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>
                          {activeSources[index] ? 'Hide' : 'View'} Retrieved Documents ({msg.sources.length})
                        </span>
                        {msg.similarity && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 ml-1">
                            {msg.similarity}% match
                          </span>
                        )}
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${
                            activeSources[index] ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {activeSources[index] && (
                        <div className="mt-2.5 space-y-2 bg-slate-950/60 p-3 rounded-xl border border-white/5 text-xs">
                          {msg.sources.map((src, sIdx) => (
                            <div key={sIdx} className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                              <div className="flex items-center justify-between text-slate-300 font-medium">
                                <span className="flex items-center space-x-1.5">
                                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="truncate max-w-xs">{src.title}</span>
                                </span>
                                <span className="text-emerald-400 font-mono text-[11px]">
                                  {src.similarity}% relevance
                                </span>
                              </div>
                              <p className="mt-1 text-slate-400 text-[11px] italic line-clamp-2">
                                "{src.preview}"
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-start space-x-3">
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-white/10 text-slate-300 flex items-center space-x-3 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Searching coaching vectors & formulating technique advice...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="p-4 border-t border-white/10 bg-slate-900/60 backdrop-blur-md">
          <form
            onSubmit={handleSendMessage}
            className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-800/80 border border-white/10 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-emerald-500/50 focus-within:border-transparent transition-all"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about batting technique, bowling action, fielding drills..."
              className="flex-1 bg-transparent resize-none px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none max-h-32 min-h-[40px]"
            />

            <button
              type="submit"
              disabled={!inputMessage.trim() || sending}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white shadow-md shadow-emerald-700/20 transition-all cursor-pointer flex-shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-[11px] text-center text-slate-500 mt-2">
            Cricket Coaching AI only answers using uploaded academy materials. Non-cricket queries are strictly declined.
          </p>
        </div>
      </div>
    </div>
  );
}
