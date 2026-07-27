-- Stores words, phrases, or sentences a user has bookmarked for later
-- review, sourced either from the Learn flow or from Interview prep.
create table public.saved_items (
  id uuid not null default gen_random_uuid()
    primary key,

  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  item_type text not null
    check (item_type in ('word', 'phrase', 'sentence')),

  -- The saved English word, phrase, or full sentence.
  content text not null
    check (length(trim(content)) > 0),

  -- Chinese meaning or sentence translation, when available.
  chinese_text text,

  source_type text not null
    check (source_type in ('learning', 'interview')),

  -- For "learning" sources this mirrors the local VocabularyItem.id (e.g.
  -- "dev-stakeholder"). For "interview" sources this will later reference a
  -- question, answer, or interview record id — none of those tables exist
  -- yet, so this stays plain text with no foreign key.
  source_id text,

  created_at timestamptz not null default now(),

  -- Prevents the same user from bookmarking identical English content
  -- twice; different users can still save the same content independently.
  unique (user_id, content)
);

alter table public.saved_items enable row level security;

-- Start from a clean slate rather than assuming project-level default
-- grants, then hand out exactly the privileges each role needs.
revoke all on table public.saved_items from anon;
revoke all on table public.saved_items from authenticated;
grant select, insert, update, delete on table public.saved_items to authenticated;

create policy "saved_items_select_own"
  on public.saved_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "saved_items_insert_own"
  on public.saved_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "saved_items_update_own"
  on public.saved_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "saved_items_delete_own"
  on public.saved_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
