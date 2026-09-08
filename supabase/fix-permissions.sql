-- ==============================================================================
-- Grant Table & Schema Privileges to Supabase Roles
-- Run this in the Supabase SQL Editor to grant required access to service_role,
-- authenticated, and anon roles.
-- ==============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to postgres, anon, authenticated, service_role;
