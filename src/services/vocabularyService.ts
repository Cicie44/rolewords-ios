import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type { VocabularyItem, WordBook } from '@/src/types/vocabulary';

type WordBookRow = Database['public']['Tables']['word_books']['Row'];
type VocabularyItemRow = Database['public']['Tables']['vocabulary_items']['Row'];
type GeneratedVocabularyItemRow = Database['public']['Tables']['user_generated_vocabulary_items']['Row'];
type ExpansionSettingRow = Database['public']['Tables']['user_vocabulary_expansion_settings']['Row'];

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

type SelectedGeneratedVocabularyItemRow = Pick<
  GeneratedVocabularyItemRow,
  | 'id'
  | 'word_book_id'
  | 'term'
  | 'chinese_meaning'
  | 'part_of_speech'
  | 'english_definition'
  | 'example_sentence'
  | 'example_translation'
  | 'tags'
  | 'created_at'
  | 'position_in_batch'
>;

const GENERATED_VOCABULARY_ITEM_SELECT_COLUMNS =
  'id, word_book_id, term, chinese_meaning, part_of_speech, english_definition, example_sentence, example_translation, tags, created_at, position_in_batch';

// Supabase's default max_rows (see supabase/config.toml's [api] section) is
// 1000 — a user's generation history for one book grows by up to 20 rows a
// day, so it must page through with .range() rather than trust a single
// select() once that history grows past a year or so.
const GENERATED_VOCABULARY_PAGE_SIZE = 1000;

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

// Converts one user_generated_vocabulary_items row (snake_case, this user's
// own private AI-expansion word) into the same VocabularyItem shape as a
// public catalog item, so the rest of the app never needs to know which
// table a given word actually came from. Generated items never carry an
// IPA transcription or a pronunciation override — those fields are always
// undefined here rather than invented.
function rowToGeneratedVocabularyItem(row: SelectedGeneratedVocabularyItemRow): VocabularyItem {
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
    ipa: undefined,
    pronunciationText: undefined,
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
 * Fetches the current user's own active AI-generated vocabulary items for
 * one word book, in stable created_at / position_in_batch / id order (a
 * later batch's words always come after an earlier batch's, and within one
 * batch, position_in_batch order is preserved). RLS already scopes this to
 * rows owned by the signed-in user — there is no userId parameter. Pages
 * through with .range() rather than a single select(), since this list only
 * grows over time and can eventually exceed Supabase's default 1000-row limit.
 */
export async function fetchGeneratedVocabularyByWordBookId(wordBookId: string): Promise<VocabularyItem[]> {
  const trimmedWordBookId = wordBookId.trim();
  if (trimmedWordBookId.length === 0) {
    return [];
  }

  const all: VocabularyItem[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('user_generated_vocabulary_items')
      .select<string, SelectedGeneratedVocabularyItemRow>(GENERATED_VOCABULARY_ITEM_SELECT_COLUMNS)
      .eq('word_book_id', trimmedWordBookId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .order('position_in_batch', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + GENERATED_VOCABULARY_PAGE_SIZE - 1);

    if (error) {
      throw new Error('Failed to fetch generated vocabulary items.');
    }
    if (!data || data.length === 0) {
      break;
    }

    all.push(...data.map(rowToGeneratedVocabularyItem));

    if (data.length < GENERATED_VOCABULARY_PAGE_SIZE) {
      break;
    }
    offset += GENERATED_VOCABULARY_PAGE_SIZE;
  }

  return all;
}

/**
 * Fetches one active vocabulary item by id, checking the public catalog
 * first and — only when that has no match — the current user's own private
 * AI-generated items second, so a Saved-detail lookup works for either
 * source without the caller needing to know which one a given id came from.
 * Returns null only when *neither* source has a matching active row for
 * this id; a request failure on either query always throws rather than
 * being treated as "not found" (the generated-item lookup failing must
 * never be silently indistinguishable from the word genuinely not existing).
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

  if (data) {
    return rowToVocabularyItem(data);
  }

  const { data: generatedData, error: generatedError } = await supabase
    .from('user_generated_vocabulary_items')
    .select<string, SelectedGeneratedVocabularyItemRow>(GENERATED_VOCABULARY_ITEM_SELECT_COLUMNS)
    .eq('id', trimmedId)
    .eq('is_active', true)
    .maybeSingle();

  if (generatedError) {
    throw new Error('Failed to fetch vocabulary item.');
  }

  if (!generatedData) {
    return null;
  }

  return rowToGeneratedVocabularyItem(generatedData);
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

/**
 * Fetches whether the current user has AI daily vocabulary expansion turned
 * on for one word book. No row for this (user, word book) pair is
 * equivalent to disabled — the setting only ever gets created the first
 * time the user opts in. A request failure always throws rather than being
 * treated as "disabled": a network/permission failure must never be
 * silently disguised as the user's real, saved preference.
 */
export async function fetchVocabularyExpansionSetting(wordBookId: string): Promise<boolean> {
  const trimmedWordBookId = wordBookId.trim();
  if (trimmedWordBookId.length === 0) {
    return false;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('user_vocabulary_expansion_settings')
    .select<string, Pick<ExpansionSettingRow, 'is_enabled'>>('is_enabled')
    .eq('user_id', session.user.id)
    .eq('word_book_id', trimmedWordBookId)
    .maybeSingle();

  if (error) {
    throw new Error('Failed to fetch vocabulary expansion setting.');
  }

  return data?.is_enabled ?? false;
}

/**
 * Turns AI daily vocabulary expansion on or off for the current user and
 * one word book. Upserts on the table's own (user_id, word_book_id) primary
 * key, so this is idempotent and always writes exactly one row for exactly
 * this user — the row is never addressed by anything the caller supplies.
 */
export async function setVocabularyExpansionEnabled(wordBookId: string, enabled: boolean): Promise<void> {
  const trimmedWordBookId = wordBookId.trim();
  if (trimmedWordBookId.length === 0) {
    throw new Error('wordBookId is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { error } = await supabase.from('user_vocabulary_expansion_settings').upsert(
    {
      user_id: session.user.id,
      word_book_id: trimmedWordBookId,
      is_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,word_book_id' },
  );

  if (error) {
    throw new Error('Failed to update vocabulary expansion setting.');
  }
}

/**
 * The generate-vocabulary-expansion Edge Function's full set of business
 * outcomes. Deliberately a strict discriminated union rather than a loose
 * "did it work" boolean — disabled/base_incomplete/backlog_remaining/
 * generation_in_progress are all normal, expected states, not errors, and
 * the caller needs to render each one differently.
 */
export type VocabularyExpansionResponse =
  | { status: 'disabled' }
  | { status: 'base_incomplete'; remainingBaseCount: number }
  | { status: 'backlog_remaining'; remainingGeneratedCount: number }
  | { status: 'generation_in_progress' }
  | { status: 'generated'; batchId: string; generatedCount: number; items: VocabularyItem[] }
  | { status: 'already_generated'; batchId: string; generatedCount: number; items: VocabularyItem[] };

// The Edge Function's per-item shape has no wordBookId (every item in one
// response always belongs to the single word book that was requested, so
// it's injected here from the request instead) and never an ipa/
// pronunciationText (generated items never have either — see
// rowToGeneratedVocabularyItem above).
function parseGeneratedItemFromFunctionResponse(value: unknown, wordBookId: string): VocabularyItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;

  const { id, term, chineseMeaning, partOfSpeech, englishDefinition, exampleSentence, exampleTranslation, tags } =
    record;

  if (typeof id !== 'string' || id.trim().length === 0) return null;
  if (typeof term !== 'string' || term.trim().length === 0) return null;
  if (typeof chineseMeaning !== 'string' || chineseMeaning.trim().length === 0) return null;
  if (partOfSpeech !== undefined && typeof partOfSpeech !== 'string') return null;
  if (englishDefinition !== undefined && typeof englishDefinition !== 'string') return null;
  if (exampleSentence !== undefined && typeof exampleSentence !== 'string') return null;
  if (exampleTranslation !== undefined && typeof exampleTranslation !== 'string') return null;
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return null;

  return {
    id,
    term,
    chineseMeaning,
    partOfSpeech: partOfSpeech as string | undefined,
    englishDefinition: englishDefinition as string | undefined,
    exampleSentence: exampleSentence as string | undefined,
    exampleTranslation: exampleTranslation as string | undefined,
    wordBookId,
    tags: tags as string[],
    ipa: undefined,
    pronunciationText: undefined,
  };
}

// Never trusts an unrecognized `status` (or a malformed payload for a
// recognized one) as a success — anything that doesn't cleanly match one of
// the six known shapes returns null, which requestVocabularyExpansion below
// turns into a thrown error rather than a forced-cast "success".
function parseVocabularyExpansionResponse(value: unknown, wordBookId: string): VocabularyExpansionResponse | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const status = record.status;

  if (status === 'disabled') {
    return { status: 'disabled' };
  }

  if (status === 'base_incomplete') {
    if (typeof record.remainingBaseCount !== 'number') return null;
    return { status: 'base_incomplete', remainingBaseCount: record.remainingBaseCount };
  }

  if (status === 'backlog_remaining') {
    if (typeof record.remainingGeneratedCount !== 'number') return null;
    return { status: 'backlog_remaining', remainingGeneratedCount: record.remainingGeneratedCount };
  }

  if (status === 'generation_in_progress') {
    return { status: 'generation_in_progress' };
  }

  if (status === 'generated' || status === 'already_generated') {
    if (typeof record.batchId !== 'string' || record.batchId.trim().length === 0) return null;
    if (typeof record.generatedCount !== 'number') return null;
    if (!Array.isArray(record.items)) return null;

    const items: VocabularyItem[] = [];
    for (const rawItem of record.items) {
      const item = parseGeneratedItemFromFunctionResponse(rawItem, wordBookId);
      if (!item) return null;
      items.push(item);
    }

    return { status, batchId: record.batchId, generatedCount: record.generatedCount, items };
  }

  return null;
}

/**
 * Invokes the deployed generate-vocabulary-expansion Edge Function for one
 * word book. Auth is handled entirely by the shared Supabase client's
 * active session, same as the Interview generation calls — no Authorization
 * header or Function URL is built by hand here. Any invocation failure
 * (network error, non-2xx response) or a response that doesn't parse as one
 * of the six known outcomes is converted into a single safe Error; nothing
 * about the failure (status code, raw body, token, or user info) is ever
 * logged to the console.
 */
export async function requestVocabularyExpansion(wordBookId: string): Promise<VocabularyExpansionResponse> {
  const trimmedWordBookId = wordBookId.trim();
  if (trimmedWordBookId.length === 0) {
    throw new Error('wordBookId is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase.functions.invoke('generate-vocabulary-expansion', {
    body: { wordBookId: trimmedWordBookId },
  });

  if (error) {
    throw new Error('Failed to request vocabulary expansion.');
  }

  const parsed = parseVocabularyExpansionResponse(data, trimmedWordBookId);
  if (!parsed) {
    throw new Error('Vocabulary expansion returned an invalid response.');
  }

  return parsed;
}
