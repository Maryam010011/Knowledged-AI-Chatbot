-- ==============================================================================
-- Cricket Coaching RAG Chatbot - Supabase Database Schema & RLS
-- ==============================================================================

-- 1. Enable Vector Extension
create extension if not exists vector;

-- 2. Academies (tenants) — one per coach
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  created_at timestamptz default now()
);

-- 3. User profiles, linked 1:1 to Supabase auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  role text not null check (role in ('admin','member')),
  full_name text,
  created_at timestamptz default now()
);

-- 4. Join requests (pending / accepted / rejected) — doubles as invite history log
create table if not exists invite_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  email text not null,
  full_name text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  requested_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id)
);

-- 5. Uploaded knowledge-base documents (admin-managed)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  title text not null,
  storage_path text not null,
  uploaded_by uuid references profiles(id),
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  created_at timestamptz default now()
);

-- 6. Text chunks + embeddings for retrieval (384 dimensions for all-MiniLM-L6-v2)
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  organization_id uuid references organizations(id) not null, -- denormalized for fast RLS + filtering
  content text not null,
  embedding vector(384),
  metadata jsonb default '{}'::jsonb, -- page number, section, etc.
  created_at timestamptz default now()
);

-- 7. Private conversations per user
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  organization_id uuid references organizations(id) not null,
  title text,
  created_at timestamptz default now()
);

-- 8. Messages in conversation
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- ==============================================================================
-- Indexes
-- ==============================================================================
create index if not exists idx_document_chunks_org on document_chunks (organization_id);
create index if not exists idx_document_chunks_doc on document_chunks (document_id);
create index if not exists idx_conversations_user on conversations (user_id);
create index if not exists idx_messages_conversation on messages (conversation_id);
create index if not exists idx_invite_requests_org_status on invite_requests (organization_id, status);
create index if not exists idx_organizations_invite_code on organizations (invite_code);

-- Create IVFFlat cosine index if enough rows exist (or fall back to HNSW if supported)
create index if not exists idx_document_chunks_embedding 
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- ==============================================================================
-- Row-Level Security (RLS)
-- ==============================================================================
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table invite_requests enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

-- Organizations policies
create policy "allow public read org by invite code" on organizations
  for select using (true);

create policy "allow authenticated coach create org" on organizations
  for insert with check (auth.role() = 'authenticated');

-- Profiles policies
create policy "own profile" on profiles
  for select using (id = auth.uid());

create policy "admin read org profiles" on profiles
  for select using (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (select role from profiles p2 where p2.id = auth.uid()) = 'admin'
  );

create policy "users can insert own profile" on profiles
  for insert with check (id = auth.uid());

create policy "users can update own profile" on profiles
  for update using (id = auth.uid());

-- Conversations: strictly owner-only
create policy "own conversations" on conversations
  for all using (user_id = auth.uid());

-- Messages: only via an owned conversation
create policy "own messages" on messages
  for all using (
    conversation_id in (select id from conversations where user_id = auth.uid())
  );

-- Documents: readable by anyone in the same org
create policy "org read documents" on documents
  for select using (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

-- Documents: only admins can insert/update/delete
create policy "admin write documents" on documents
  for insert with check (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "admin update documents" on documents
  for update using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "admin delete documents" on documents
  for delete using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

-- Document chunks: same org-read / admin-write pattern
create policy "org read chunks" on document_chunks
  for select using (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

create policy "admin write chunks" on document_chunks
  for insert with check (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "admin delete chunks" on document_chunks
  for delete using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

-- Invite requests: admins can manage; allow prospective member insert
create policy "admin manage invites" on invite_requests
  for all using (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "allow insert invite request" on invite_requests
  for insert with check (true);

-- ==============================================================================
-- Vector Similarity Match RPC Function
-- ==============================================================================
create or replace function match_document_chunks (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  filter_organization_id uuid
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where dc.organization_id = filter_organization_id
    and (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  order by dc.embedding <=> query_embedding asc
  limit match_count;
$$;

-- ==============================================================================
-- Supabase Storage Bucket Setup
-- ==============================================================================
insert into storage.buckets (id, name, public)
values ('coach-documents', 'coach-documents', false)
on conflict (id) do nothing;

create policy "authenticated download coach documents"
  on storage.objects for select
  using (bucket_id = 'coach-documents' and auth.role() = 'authenticated');

create policy "admin upload coach documents"
  on storage.objects for insert
  with check (bucket_id = 'coach-documents' and auth.role() = 'authenticated');

create policy "admin delete coach documents"
  on storage.objects for delete
  using (bucket_id = 'coach-documents' and auth.role() = 'authenticated');

-- ==============================================================================
-- Table & Schema Permissions (Grant to service_role, authenticated, anon)
-- ==============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to postgres, anon, authenticated, service_role;

