-- ==============================================================================
-- ONE COACH/ADMIN PER ACADEMY DATABASE CONSTRAINT & RLS HARDENING
-- ==============================================================================
-- Run this script in your Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/nanwtreeywethzysklox/sql/new
-- ==============================================================================

-- 1. Database-level partial unique index to enforce exactly ONE admin per organization
-- This prevents concurrent requests or malicious payloads from creating two admins.
create unique index if not exists idx_profiles_single_admin_per_org
  on public.profiles (organization_id)
  where role = 'admin';

-- 2. Harden Profiles RLS Policies
alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "admin read org profiles" on public.profiles;
drop policy if exists "users can insert own profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;

-- Users can read their own profile
create policy "own profile" on public.profiles
  for select using (id = auth.uid());

-- Coaches/Admins can read profiles within their organization
create policy "admin read org profiles" on public.profiles
  for select using (
    organization_id = public.get_auth_user_organization_id()
    and public.get_auth_user_role() = 'admin'
  );

-- Users can insert their own profile via client only as 'member'
-- Admin profiles can only be created by backend service_role (e.g. signup-coach API)
create policy "users can insert own profile" on public.profiles
  for insert with check (
    id = auth.uid()
    and role = 'member'
  );

-- Users can only update their own display full_name.
-- Role and organization_id cannot be altered via client-side RLS update.
create policy "users can update own profile" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.get_auth_user_role()
    and organization_id is not distinct from public.get_auth_user_organization_id()
  );
