export type UserRole = 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

export interface Profile {
  id: string;
  organization_id: string | null;
  role: UserRole;
  full_name: string | null;
  created_at: string;
}

export interface InviteRequest {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface Document {
  id: string;
  organization_id: string;
  title: string;
  storage_path: string;
  uploaded_by: string | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  organization_id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: string;
  similarity?: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  organization_id: string;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
