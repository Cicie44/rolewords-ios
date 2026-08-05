-- Marks a word as an unresolved Learn "carryover": it has been shown in
-- Learn but hasn't reached the recognition streak or hit the per-group
-- presentation cap yet, so the next Learn group must keep reinforcing it
-- instead of only offering brand-new words, and it must stay out of Review
-- even if its next_review_at has already passed.
--
-- Historical rows default to false uniformly. We deliberately do not
-- backfill true for existing status = 'learning' rows: those may have
-- already graduated into Review under the old scheduler, and there is no
-- safe way to distinguish that from a genuine in-progress Learn word after
-- the fact.
alter table public.user_word_progress
  add column needs_learn_reinforcement boolean not null default false;
