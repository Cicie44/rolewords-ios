-- Interview prep questions generated (later, by AI) for a given interview
-- session. Ownership is not duplicated here — a question's owner is always
-- looked up through its parent interview_sessions row, so there is no
-- separate user_id to ever drift out of sync with the parent.
create table public.interview_questions (
  id uuid not null default gen_random_uuid()
    primary key,

  interview_session_id uuid not null
    references public.interview_sessions (id) on delete cascade,

  -- Position within the ~10-question set for one session; capped well above
  -- the expected count to leave a little room without allowing arbitrary values.
  question_order integer not null
    check (question_order between 1 and 20),

  question_type text not null
    check (question_type in ('behavioral', 'technical', 'role_specific', 'general')),

  -- The AI-generated interview question itself.
  question_text text not null
    check (length(trim(question_text)) > 0),

  -- User-supplied experience/talking points to personalize the answer.
  user_notes text,

  -- AI-generated reference answer. Whether it follows STAR or a plain
  -- structure is a prompt-time decision, not a schema-level one, so this
  -- stays a single plain-text field rather than a structured JSON shape.
  generated_answer text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The unique constraint creates a composite index whose leading column is
  -- interview_session_id, so it already supports queries filtered by that
  -- column without a duplicate single-column index.
  unique (interview_session_id, question_order)
);

alter table public.interview_questions enable row level security;

-- Start from a clean slate rather than assuming project-level default
-- grants, then hand out exactly the privileges each role needs.
revoke all on table public.interview_questions from anon;
revoke all on table public.interview_questions from authenticated;
grant select, insert, update, delete on table public.interview_questions to authenticated;

-- Ownership is derived entirely from the parent interview_sessions row: a
-- question is only visible/mutable when its interview_session_id points to
-- a session owned by the current user. For UPDATE, this same check runs
-- against both the pre-update row (using) and the post-update row (with
-- check), so a user can't "move" a question onto someone else's session by
-- changing interview_session_id — the new session_id must also resolve to
-- a session they own, or the update is rejected.
create policy "interview_questions_select_own"
  on public.interview_questions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.interview_sessions as session
      where session.id = interview_questions.interview_session_id
        and session.user_id = (select auth.uid())
    )
  );

create policy "interview_questions_insert_own"
  on public.interview_questions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.interview_sessions as session
      where session.id = interview_questions.interview_session_id
        and session.user_id = (select auth.uid())
    )
  );

create policy "interview_questions_update_own"
  on public.interview_questions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.interview_sessions as session
      where session.id = interview_questions.interview_session_id
        and session.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.interview_sessions as session
      where session.id = interview_questions.interview_session_id
        and session.user_id = (select auth.uid())
    )
  );

create policy "interview_questions_delete_own"
  on public.interview_questions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.interview_sessions as session
      where session.id = interview_questions.interview_session_id
        and session.user_id = (select auth.uid())
    )
  );
