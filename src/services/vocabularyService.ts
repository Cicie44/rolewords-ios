import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type { VocabularyItem, WordBook } from '@/src/types/vocabulary';

type WordBookRow = Database['public']['Tables']['word_books']['Row'];
type VocabularyItemRow = Database['public']['Tables']['vocabulary_items']['Row'];

type SelectedWordBookRow = Pick<
  WordBookRow,
  'id' | 'title' | 'chinese_title' | 'description' | 'category'
>;

const WORD_BOOK_SELECT_COLUMNS = 'id, title, chinese_title, description, category';

type SelectedVocabularyItemRow = Pick<
  VocabularyItemRow,
  | 'id'
  | 'word_book_id'
  | 'term'
  | 'chinese_meaning'
  | 'part_of_speech'
  | 'english_definition'
  | 'example_sentence'
  | 'example_translation'
  | 'tags'
  | 'ipa'
  | 'pronunciation_text'
>;

const VOCABULARY_ITEM_SELECT_COLUMNS =
  'id, word_book_id, term, chinese_meaning, part_of_speech, english_definition, example_sentence, example_translation, tags, ipa, pronunciation_text';

// Converts one word_books row (snake_case) into the app's business type
// (camelCase). sort_order and is_active are query-only filters/ordering —
// WordBook itself doesn't carry them.
function rowToWordBook(row: SelectedWordBookRow): WordBook {
  return {
    id: row.id,
    title: row.title,
    chineseTitle: row.chinese_title,
    description: row.description,
    category: row.category,
  };
}

// Converts one vocabulary_items row (snake_case) into the app's business
// type (camelCase), turning nullable optional fields into undefined.
function rowToVocabularyItem(row: SelectedVocabularyItemRow): VocabularyItem {
  return {
    id: row.id,
    term: row.term,
    chineseMeaning: row.chinese_meaning,
    partOfSpeech: row.part_of_speech ?? undefined,
    englishDefinition: row.english_definition ?? undefined,
    exampleSentence: row.example_sentence ?? undefined,
    exampleTranslation: row.example_translation ?? undefined,
    wordBookId: row.word_book_id,
    tags: row.tags,
    ipa: row.ipa ?? undefined,
    pronunciationText: row.pronunciation_text ?? undefined,
  };
}

/**
 * Fetches every active word book, in display order. Only three rows exist
 * today, well under Supabase's default 1000-row limit.
 */
export async function fetchWordBooks(): Promise<WordBook[]> {
  const { data, error } = await supabase
    .from('word_books')
    .select<string, SelectedWordBookRow>(WORD_BOOK_SELECT_COLUMNS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error('Failed to fetch word books.');
  }

  return (data ?? []).map(rowToWordBook);
}

/**
 * Fetches every active vocabulary item belonging to one word book, in that
 * book's stable order. Deliberately scoped to a single word book — each
 * book holds around 500 rows, comfortably under the default 1000-row
 * limit, but the whole catalog across all books would not be.
 */
export async function fetchVocabularyByWordBookId(wordBookId: string): Promise<VocabularyItem[]> {
  const trimmedWordBookId = wordBookId.trim();
  if (trimmedWordBookId.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('vocabulary_items')
    .select<string, SelectedVocabularyItemRow>(VOCABULARY_ITEM_SELECT_COLUMNS)
    .eq('word_book_id', trimmedWordBookId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error('Failed to fetch vocabulary items.');
  }

  return (data ?? []).map(rowToVocabularyItem);
}

/**
 * Fetches one active vocabulary item by id. Returns null both when the id
 * doesn't exist and when the row exists but is inactive — a caller that
 * just needs "is there a real item to show" doesn't need to distinguish
 * the two.
 */
export async function fetchVocabularyItemById(id: string): Promise<VocabularyItem | null> {
  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('vocabulary_items')
    .select<string, SelectedVocabularyItemRow>(VOCABULARY_ITEM_SELECT_COLUMNS)
    .eq('id', trimmedId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error('Failed to fetch vocabulary item.');
  }

  if (!data) {
    return null;
  }

  return rowToVocabularyItem(data);
}

/**
 * Looks up an active vocabulary item's Chinese meaning by exact normalized
 * term match (trim, lowercase, collapse whitespace — via the
 * find_vocabulary_chinese_meaning RPC, which applies the same rule
 * server-side). Returns null on a genuine no-match; throws on a request
 * failure, so callers can tell the two apart instead of treating a failed
 * lookup as "no match" and falling back to AI generation unnecessarily.
 */
export async function findVocabularyChineseMeaningByTerm(term: string): Promise<string | null> {
  const trimmedTerm = term.trim();
  if (trimmedTerm.length === 0) {
    return null;
  }

  const { data, error } = await supabase.rpc('find_vocabulary_chinese_meaning', {
    p_term: trimmedTerm,
  });

  if (error) {
    throw new Error('Failed to look up vocabulary Chinese meaning.');
  }

  return data ?? null;
}
