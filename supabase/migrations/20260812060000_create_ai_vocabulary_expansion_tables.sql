-- Phase 1 of "AI 每日扩展词汇": schema only. No Edge Function, cron, or
-- client service exists yet — these tables are written by a future
-- service_role-authenticated Edge Function, never directly by the client
-- (except toggling user_vocabulary_expansion_settings.is_enabled).
--
-- None of this touches user_word_progress, vocabulary_items, word_books, or
-- the Learn/Review scheduler. user_word_progress.vocabulary_item_id (see
-- 20260726224519_create_user_word_progress.sql) is a plain text column with
-- no foreign key, so it can already hold a generated item's uuid (cast to
-- text) once a future phase wires progress tracking up to these words —
-- nothing here needs to change to support that.

-- Shared updated_at maintenance for this feature's three tables. Named
-- specifically for this feature (rather than a generic set_updated_at)
-- so it can't be mistaken for, or collide with, a shared/global trigger
-- some other feature might add later. The rest of the codebase sets
-- updated_at explicitly from the service layer on every write (see e.g.
-- interviewService.ts) instead of using a trigger, but this feature's write
-- path lives entirely in a not-yet-written Edge Function, so a trigger is
-- the safer default: it keeps updated_at correct even if that future code
-- forgets to set it, and it costs nothing today.
create or replace function public.set_ai_vocabulary_expansion_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Only ever invoked implicitly by the BEFORE UPDATE triggers below, which
-- run with the privileges of the triggering statement's role regardless of
-- function-level EXECUTE grants — so revoking direct EXECUTE from every
-- client-facing role (including service_role's ordinary callers) removes an
-- unnecessary RPC-style entry point without breaking the triggers.
revoke all on function public.set_ai_vocabulary_expansion_updated_at() from public;
revoke all on function public.set_ai_vocabulary_expansion_updated_at() from anon;
revoke all on function public.set_ai_vocabulary_expansion_updated_at() from authenticated;

-- ---------------------------------------------------------------------
-- 1. user_vocabulary_expansion_settings
-- Whether a user has opted a given word book into AI daily expansion.
-- Pausing is done by setting is_enabled = false, not by deleting the row —
-- there is deliberately no delete policy or grant.
-- ---------------------------------------------------------------------
create table public.user_vocabulary_expansion_settings (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  word_book_id text not null
    references public.word_books (id),

  is_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite primary key: one setting row per user per word book, and the
  -- natural conflict target for an upsert toggle. No separate id column.
  primary key (user_id, word_book_id)
);

alter table public.user_vocabulary_expansion_settings enable row level security;

-- Start from a clean slate rather than assuming project-level default
-- grants, then hand out exactly the privileges each role needs.
revoke all on table public.user_vocabulary_expansion_settings from anon;
revoke all on table public.user_vocabulary_expansion_settings from authenticated;
grant select, insert, update on table public.user_vocabulary_expansion_settings to authenticated;

create policy "user_vocabulary_expansion_settings_select_own"
  on public.user_vocabulary_expansion_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_vocabulary_expansion_settings_insert_own"
  on public.user_vocabulary_expansion_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_vocabulary_expansion_settings_update_own"
  on public.user_vocabulary_expansion_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger user_vocabulary_expansion_settings_set_updated_at
  before update on public.user_vocabulary_expansion_settings
  for each row
  execute function public.set_ai_vocabulary_expansion_updated_at();

-- ---------------------------------------------------------------------
-- 2. user_vocabulary_generation_batches
-- One row per generation attempt. The unique (user_id, word_book_id,
-- generation_day) constraint is what actually guarantees "at most one batch
-- per user/book/day" — it is also the natural idempotency key a retrying
-- Edge Function upserts against, so a failed attempt can be retried the same
-- day without creating a second batch.
-- ---------------------------------------------------------------------
create table public.user_vocabulary_generation_batches (
  id uuid not null default gen_random_uuid()
    primary key,

  user_id uuid not null
    references auth.users (id) on delete cascade,

  word_book_id text not null
    references public.word_books (id),

  -- The UTC calendar day this batch belongs to, independent of the
  -- requesting client's local time zone.
  generation_day date not null
    default (now() at time zone 'utc')::date,

  status text not null default 'generating'
    check (status in ('generating', 'completed', 'failed')),

  requested_count integer not null default 20
    check (requested_count between 1 and 20),

  generated_count integer not null default 0
    check (generated_count >= 0 and generated_count <= requested_count),

  -- A short, safe error code only (e.g. "ai_timeout", "quota_exceeded") —
  -- never raw AI output, prompts, or any other user-identifying content.
  failure_code text
    check (
      failure_code is null
      or (length(trim(failure_code)) > 0 and length(failure_code) <= 100)
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  -- At most one batch per user, per word book, per UTC day.
  unique (user_id, word_book_id, generation_day),

  -- Lets user_generated_vocabulary_items's composite foreign key (below)
  -- confirm a generated item's (user_id, word_book_id) always match the
  -- batch it's attached to, without a separate trigger or check.
  unique (id, user_id, word_book_id)
);

-- No standalone index on user_id or on (user_id, word_book_id): both
-- unique constraints above already lead with user_id (and the first also
-- leads with user_id, word_book_id), so "this user's batches" and "this
-- user's batches for this book" queries are already covered.

alter table public.user_vocabulary_generation_batches enable row level security;

revoke all on table public.user_vocabulary_generation_batches from anon;
revoke all on table public.user_vocabulary_generation_batches from authenticated;
grant select on table public.user_vocabulary_generation_batches to authenticated;

create policy "user_vocabulary_generation_batches_select_own"
  on public.user_vocabulary_generation_batches
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The client never creates or updates batches directly — a future Edge
-- Function authenticated as service_role does, which already bypasses RLS.
-- These grants are added explicitly (rather than relying on that implicit
-- bypass) so the intended write path is documented directly in the schema.
-- No delete grant: this phase has no flow that deletes a batch.
grant select, insert, update on table public.user_vocabulary_generation_batches to service_role;

create trigger user_vocabulary_generation_batches_set_updated_at
  before update on public.user_vocabulary_generation_batches
  for each row
  execute function public.set_ai_vocabulary_expansion_updated_at();

-- ---------------------------------------------------------------------
-- 3. user_generated_vocabulary_items
-- A user's private AI-generated words for one batch. Structurally mirrors
-- vocabulary_items (see 20260805020000_create_word_books_and_vocabulary_items.sql)
-- but is never merged into it and is never visible to other users.
-- ---------------------------------------------------------------------
create table public.user_generated_vocabulary_items (
  id uuid not null default gen_random_uuid()
    primary key,

  user_id uuid not null,
  word_book_id text not null,
  batch_id uuid not null,

  term text not null
    check (length(trim(term)) > 0),

  chinese_meaning text not null
    check (length(trim(chinese_meaning)) > 0),

  part_of_speech text,
  english_definition text,
  example_sentence text,
  example_translation text,
  ipa text,
  pronunciation_text text,

  tags text[] not null default '{}',

  -- Position within its up-to-20-word generation batch (0-based).
  position_in_batch integer not null
    check (position_in_batch between 0 and 19),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FK into the owning batch: ties every generated item to a
  -- batch that was created for this exact (user_id, word_book_id) pair, so
  -- a row can never be attached to another user's or another word book's
  -- batch even if batch_id alone were guessed. Cascades so deleting a batch
  -- (e.g. a future retry that discards a failed attempt) cleans up its items.
  constraint user_generated_vocabulary_items_batch_fkey
    foreign key (batch_id, user_id, word_book_id)
    references public.user_vocabulary_generation_batches (id, user_id, word_book_id)
    on delete cascade,

  -- One slot per position within a batch. Its index (leading on batch_id)
  -- also covers "this batch's items" lookups and the cascade delete above,
  -- so no separate batch_id index is needed.
  unique (batch_id, position_in_batch)
);

-- Supports "does the user already have this term in this book" lookups
-- using the same normalization rule as vocabulary_items and
-- scripts/validate-vocabulary.mjs (trim, collapse whitespace, lowercase);
-- unique so the database itself rejects a duplicate, not just app-side
-- validation. Its leading columns (user_id, word_book_id) also cover plain
-- "this user's items in this book" queries.
create unique index user_generated_vocabulary_items_user_book_term_idx
  on public.user_generated_vocabulary_items (
    user_id,
    word_book_id,
    lower(regexp_replace(trim(term), '\s+', ' ', 'g'))
  );

alter table public.user_generated_vocabulary_items enable row level security;

revoke all on table public.user_generated_vocabulary_items from anon;
revoke all on table public.user_generated_vocabulary_items from authenticated;
grant select on table public.user_generated_vocabulary_items to authenticated;

create policy "user_generated_vocabulary_items_select_own"
  on public.user_generated_vocabulary_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Same reasoning as user_vocabulary_generation_batches above: only a future
-- service_role Edge Function writes here. No delete grant: this phase never
-- deletes a generated item (retiring one is done via is_active = false,
-- once a future phase adds that write path).
grant select, insert, update on table public.user_generated_vocabulary_items to service_role;

create trigger user_generated_vocabulary_items_set_updated_at
  before update on public.user_generated_vocabulary_items
  for each row
  execute function public.set_ai_vocabulary_expansion_updated_at();

-- Rejects a generated term that duplicates a *base* word already in the
-- same word book's public vocabulary_items, checked against every row
-- (active or not) so a previously deactivated base word can't reappear as a
-- "new" generated word. Runs as invoker rather than definer: it needs no
-- privilege beyond what already-RLS-bypassing service_role has, and this
-- table only ever receives writes from that role.
create or replace function public.reject_generated_vocabulary_duplicate_of_base_word()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.vocabulary_items vi
    where vi.word_book_id = new.word_book_id
      and lower(regexp_replace(trim(vi.term), '\s+', ' ', 'g'))
        = lower(regexp_replace(trim(new.term), '\s+', ' ', 'g'))
  ) then
    raise exception
      'Generated term "%" already exists as a base vocabulary word in word book "%".',
      new.term, new.word_book_id
      using errcode = '23505';
  end if;

  return new;
end;
$$;

-- Same reasoning as set_ai_vocabulary_expansion_updated_at above: only ever
-- invoked implicitly by the trigger below, so direct EXECUTE isn't needed by
-- any client-facing role (service_role's inserts/updates still fire it
-- normally — trigger execution doesn't require the triggering role to hold
-- EXECUTE on the trigger function).
revoke all on function public.reject_generated_vocabulary_duplicate_of_base_word() from public;
revoke all on function public.reject_generated_vocabulary_duplicate_of_base_word() from anon;
revoke all on function public.reject_generated_vocabulary_duplicate_of_base_word() from authenticated;

-- Fires on insert (the normal generation path) and whenever a later update
-- changes term or word_book_id — the only two columns the duplicate check
-- actually depends on — so an unrelated update (e.g. is_active) never pays
-- for the extra query.
create trigger user_generated_vocabulary_items_reject_base_word_duplicate
  before insert or update of term, word_book_id on public.user_generated_vocabulary_items
  for each row
  execute function public.reject_generated_vocabulary_duplicate_of_base_word();
