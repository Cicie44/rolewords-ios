-- Read-only lookup used by the Interview flow to prefer an exact vocabulary
-- match over calling the AI Chinese-generation Function. Runs as the
-- calling role (security invoker, not definer) so it's still subject to
-- vocabulary_items' existing RLS select policy — this function grants no
-- privilege the caller didn't already have, and gives the client no way to
-- modify vocabulary_items.
--
-- Multiple active word books can contain the same normalized term (e.g. a
-- word that belongs to both Developer and AI Research), so the match must
-- be deterministic rather than "whichever row the planner happens to pick
-- first" — ordered by word_books.sort_order then vocabulary_items.sort_order
-- before taking the first row, never an unordered limit 1.
create or replace function public.find_vocabulary_chinese_meaning(p_term text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select vi.chinese_meaning
  from public.vocabulary_items vi
  join public.word_books wb on wb.id = vi.word_book_id
  where vi.is_active = true
    and wb.is_active = true
    and lower(regexp_replace(trim(vi.term), '\s+', ' ', 'g'))
      = lower(regexp_replace(trim(p_term), '\s+', ' ', 'g'))
  order by wb.sort_order, vi.sort_order
  limit 1;
$$;

revoke all on function public.find_vocabulary_chinese_meaning(text) from public;
revoke all on function public.find_vocabulary_chinese_meaning(text) from anon;
grant execute on function public.find_vocabulary_chinese_meaning(text) to authenticated;

-- Supports the cross-word-book normalized-term lookup above. Distinct from
-- vocabulary_items_word_book_id_normalized_term_idx (which is scoped per
-- word_book_id and unique, enforcing no duplicate term within one book) —
-- this one is a plain, non-unique index over the normalized term alone, so
-- a search across every active word book doesn't fall back to a full scan.
-- Partial on is_active = true to match exactly what the function filters
-- on and keep the index smaller.
create index vocabulary_items_normalized_term_active_idx
  on public.vocabulary_items (lower(regexp_replace(trim(term), '\s+', ' ', 'g')))
  where is_active = true;
