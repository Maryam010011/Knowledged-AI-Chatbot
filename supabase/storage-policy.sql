-- Ensure coach-documents storage bucket exists
insert into storage.buckets (id, name, public)
values ('coach-documents', 'coach-documents', false)
on conflict (id) do nothing;

-- Storage RLS policy: Allow authenticated coaches/admins to upload files to coach-documents bucket
drop policy if exists "admin upload coach documents" on storage.objects;
create policy "admin upload coach documents" on storage.objects
  for insert with check (
    bucket_id = 'coach-documents'
    and auth.role() = 'authenticated'
  );

-- Storage RLS policy: Allow authenticated users to read files from coach-documents bucket
drop policy if exists "auth read coach documents" on storage.objects;
create policy "auth read coach documents" on storage.objects
  for select using (
    bucket_id = 'coach-documents'
    and auth.role() = 'authenticated'
  );
