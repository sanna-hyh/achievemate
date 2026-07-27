-- ============================================================
-- AchieveMate RLS + Storage — migration 0002
-- Pattern: every table is FORCEd RLS, owner-only, authenticated
-- only. anon gets nothing. There are no public reads anywhere.
-- ============================================================

-- ------------------------ profiles --------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT/DELETE policies: rows are created by the signup
-- trigger and removed by the auth.users cascade. The client can
-- never create or destroy a profile row directly.

-- ---------------------- achievements ------------------------
alter table public.achievements enable row level security;
alter table public.achievements force row level security;

create policy "achievements_select_own" on public.achievements
  for select to authenticated using (user_id = (select auth.uid()));

create policy "achievements_insert_own" on public.achievements
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "achievements_update_own" on public.achievements
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "achievements_delete_own" on public.achievements
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------- cv_documents ------------------------
alter table public.cv_documents enable row level security;
alter table public.cv_documents force row level security;

create policy "cv_documents_select_own" on public.cv_documents
  for select to authenticated using (user_id = (select auth.uid()));

create policy "cv_documents_update_own" on public.cv_documents
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT/DELETE: provisioned by trigger, removed by cascade.

-- --------------------- export_history -----------------------
alter table public.export_history enable row level security;
alter table public.export_history force row level security;

create policy "export_history_select_own" on public.export_history
  for select to authenticated using (user_id = (select auth.uid()));

create policy "export_history_insert_own" on public.export_history
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "export_history_delete_own" on public.export_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- No UPDATE policy: history entries are immutable.

-- ============================================================
-- Storage: private bucket for proof attachments
-- Path convention (enforced below):  <user_id>/<achievement_client_id>/<filename>
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proofs',
  'proofs',
  false,                -- private: access only via RLS + signed URLs
  5242880,              -- 5 MB per file (free-tier rule #2)
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

-- Owner-only object access: first folder of the path must equal
-- the caller's user id.
create policy "proofs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'proofs'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
