-- Tracks each authenticated user's local learning progress for a single
-- vocabulary item (word/phrase). One row per (user_id, vocabulary_item_id).
create table public.user_word_progress (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  -- Mirrors the local VocabularyItem.id from src/data/sampleVocabulary.ts
  -- (e.g. "dev-stakeholder"). Vocabulary items currently only exist in the
  -- app bundle — there is no vocabulary_items table in this database yet —
  -- so this column intentionally has no foreign key reference.
  vocabulary_item_id text not null
    check (length(trim(vocabulary_item_id)) > 0),

  status text not null default 'new'
    check (status in ('new', 'learning', 'mastered')),

  familiarity text not null default 'unknown'
    check (familiarity in ('unknown', 'fuzzy', 'known')),

  review_count integer not null default 0
    check (review_count >= 0),

  recognition_count smallint not null default 0
    check (recognition_count >= 0 and recognition_count <= 3),

  last_reviewed_at timestamptz,
  next_review_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite primary key: prevents duplicate rows per user/word and doubles
  -- as the natural conflict target for upserts. No separate id column.
  primary key (user_id, vocabulary_item_id)
);

alter table public.user_word_progress enable row level security;

-- Start from a clean slate rather than assuming project-level default
-- grants, then hand out exactly the privileges each role needs.
revoke all on table public.user_word_progress from anon;
revoke all on table public.user_word_progress from authenticated;
grant select, insert, update, delete on table public.user_word_progress to authenticated;

create policy "user_word_progress_select_own"
  on public.user_word_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_word_progress_insert_own"
  on public.user_word_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_word_progress_update_own"
  on public.user_word_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_word_progress_delete_own"
  on public.user_word_progress
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
