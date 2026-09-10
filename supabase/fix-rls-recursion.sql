-- ==============================================================================
-- FIX RLS POLICY INFINITE RECURSION (PostgreSQL ERROR 42P17)
-- ==============================================================================
-- Run this script in your Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/nanwtreeywethzysklox/sql/new
-- ==============================================================================

-- 1. Create SECURITY DEFINER helper function to retrieve user organization_id
-- Bypasses RLS during evaluation, preventing recursive subqueries on profiles.
create or replace function public.get_auth_user_organization_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.profiles where id = auth.uid() limit 1;
$$;

-- 2. Create SECURITY DEFINER helper function to retrieve user role
create or replace function public.get_auth_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

-- Grant EXECUTE privileges
grant execute on function public.get_auth_user_organization_id() to authenticated, service_role;
grant execute on function public.get_auth_user_role() to authenticated, service_role;

-- ==============================================================================
-- RE-CREATE PROFILES POLICIES
-- ==============================================================================
alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "admin read org profiles" on public.profiles;
drop policy if exists "users can insert own profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;

create policy "own profile" on public.profiles
  for select using (id = auth.uid());

create policy "admin read org profiles" on public.profiles
  for select using (
    organization_id = public.get_auth_user_organization_id()
    and public.get_auth_user_role() = 'admin'
  );

create policy "users can insert own profile" on public.profiles
  for insert with check (id = auth.uid());

create policy "users can update own profile" on public.profiles
  for update using (id = auth.uid());

-- ==============================================================================
-- RE-CREATE DOCUMENTS POLICIES
-- ==============================================================================
alter table public.documents enable row level security;

drop policy if exists "org read documents" on public.documents;
drop policy if exists "admin write documents" on public.documents;
drop policy if exists "admin update documents" on public.documents;
drop policy if exists "admin delete documents" on public.documents;

create policy "org read documents" on public.documents
  for select using (
    organization_id = public.get_auth_user_organization_id()
  );

create policy "admin write documents" on public.documents
  for insert with check (
    public.get_auth_user_role() = 'admin'
  );

create policy "admin update documents" on public.documents
  for update using (
    public.get_auth_user_role() = 'admin'
  );

create policy "admin delete documents" on public.documents
  for delete using (
    public.get_auth_user_role() = 'admin'
  );

-- ==============================================================================
-- RE-CREATE DOCUMENT CHUNKS POLICIES
-- ==============================================================================
alter table public.document_chunks enable row level security;

drop policy if exists "org read chunks" on public.document_chunks;
drop policy if exists "admin write chunks" on public.document_chunks;
drop policy if exists "admin delete chunks" on public.document_chunks;

create policy "org read chunks" on public.document_chunks
  for select using (
    organization_id = public.get_auth_user_organization_id()
  );

create policy "admin write chunks" on public.document_chunks
  for insert with check (
    public.get_auth_user_role() = 'admin'
  );

create policy "admin delete chunks" on public.document_chunks
  for delete using (
    public.get_auth_user_role() = 'admin'
  );

-- ==============================================================================
-- RE-CREATE INVITE REQUESTS POLICIES
-- ==============================================================================
alter table public.invite_requests enable row level security;

drop policy if exists "admin manage invites" on public.invite_requests;
drop policy if exists "allow insert invite request" on public.invite_requests;

create policy "admin manage invites" on public.invite_requests
  for all using (
    organization_id = public.get_auth_user_organization_id()
    and public.get_auth_user_role() = 'admin'
  );

create policy "allow insert invite request" on public.invite_requests
  for insert with check (true);

-- ==============================================================================
-- RE-CREATE CONVERSATIONS & MESSAGES POLICIES
-- ==============================================================================
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all using (user_id = auth.uid());

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all using (
    conversation_id in (select id from public.conversations where user_id = auth.uid())
  );

-- Grant privileges
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;
