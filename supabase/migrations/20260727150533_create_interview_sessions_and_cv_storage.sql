-- Interview prep sessions: one row per "prepare for this job" attempt.
-- The uploaded CV's binary content and extracted text are never stored
-- here — only a pointer to the private Storage object holding the PDF.
create table public.interview_sessions (
  id uuid not null default gen_random_uuid()
    primary key,

  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  job_title text not null
    check (length(trim(job_title)) > 0),

  company_name text not null
    check (length(trim(company_name)) > 0),

  job_description text,

  -- Storage object path, e.g. "{user_id}/{interview_session_id}/cv.pdf".
  -- Nullable because a draft session can exist before a CV is uploaded.
  cv_storage_path text,
  cv_file_name text,
  cv_mime_type text,

  status text not null default 'draft'
    check (status in ('draft', 'questions_ready', 'answers_ready', 'completed', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.interview_sessions enable row level security;

-- Start from a clean slate rather than assuming project-level default
-- grants, then hand out exactly the privileges each role needs.
revoke all on table public.interview_sessions from anon;
revoke all on table public.interview_sessions from authenticated;
grant select, insert, update, delete on table public.interview_sessions to authenticated;

create policy "interview_sessions_select_own"
  on public.interview_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "interview_sessions_insert_own"
  on public.interview_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "interview_sessions_update_own"
  on public.interview_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "interview_sessions_delete_own"
  on public.interview_sessions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Private bucket for uploaded CV PDFs. `public = false` means objects are
-- only reachable through the storage.objects policies below (per-user
-- folder scoping) — never via a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('interview-cvs', 'interview-cvs', false, 10485760, array['application/pdf']);

-- Object paths follow the convention "{user_id}/{interview_session_id}/cv.pdf".
-- storage.foldername(name) splits the path into its folder segments (all
-- parts except the filename), so foldername(name)[1] is always the first
-- segment — the owning user's id. This does not touch storage.objects'
-- table structure or its existing global grants, only adds scoped policies.
create policy "interview_cvs_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'interview-cvs'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

create policy "interview_cvs_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'interview-cvs'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

create policy "interview_cvs_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'interview-cvs'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'interview-cvs'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

create policy "interview_cvs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'interview-cvs'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );
