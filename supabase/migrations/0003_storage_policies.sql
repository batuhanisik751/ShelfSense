-- ============================================================
-- 0003_storage_policies.sql — Storage RLS for receipts bucket
-- Upload path: receipts/{user_id}/{uuid}.{ext}
-- The bucket itself was created in the Supabase dashboard (Phase 0.2).
-- These policies enforce owner-only access at the row level.
-- ============================================================

-- SELECT: owner can read their own files
create policy "receipts owner read"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- INSERT: owner can upload into their own folder
create policy "receipts owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- UPDATE: owner can overwrite their own files.
-- `with check` is required so a user cannot rename a file out of their folder.
create policy "receipts owner update"
  on storage.objects for update
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE: owner can delete their own files
create policy "receipts owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
