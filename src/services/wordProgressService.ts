import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type { Familiarity, LearningStatus, UserWordProgress } from '@/src/types/vocabulary';

export type ProgressByItemId = Record<string, UserWordProgress>;

type WordProgressRow = Database['public']['Tables']['user_word_progress']['Row'];

type SelectedWordProgressRow = Pick<
  WordProgressRow,
  | 'vocabulary_item_id'
  | 'status'
  | 'familiarity'
  | 'review_count'
  | 'recognition_count'
  | 'last_reviewed_at'
  | 'next_review_at'
  | 'needs_learn_reinforcement'
>;

const SELECT_COLUMNS =
  'vocabulary_item_id, status, familiarity, review_count, recognition_count, last_reviewed_at, next_review_at, needs_learn_reinforcement';

// Converts one database row (snake_case) into the app's business type
// (camelCase), turning nullable timestamps into undefined.
function rowToProgress(row: SelectedWordProgressRow): UserWordProgress {
  return {
    vocabularyItemId: row.vocabulary_item_id,
    status: row.status as LearningStatus,
    familiarity: row.familiarity as Familiarity,
    reviewCount: row.review_count,
    recognitionCount: row.recognition_count,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    nextReviewAt: row.next_review_at ?? undefined,
    needsLearnReinforcement: row.needs_learn_reinforcement,
  };
}

/**
 * Fetches the current user's word progress. RLS restricts the query to rows
 * owned by the signed-in user, so there is no userId parameter.
 */
export async function fetchWordProgress(): Promise<ProgressByItemId> {
  const { data, error } = await supabase
    .from('user_word_progress')
    .select<string, SelectedWordProgressRow>(SELECT_COLUMNS);

  if (error) {
    throw new Error('Failed to fetch word progress.');
  }

  if (!data) {
    return {};
  }

  const progressByItemId: ProgressByItemId = {};
  for (const row of data) {
    progressByItemId[row.vocabulary_item_id] = rowToProgress(row);
  }
  return progressByItemId;
}

/**
 * Upserts a single word's progress for the current user. Requires an active
 * session — the composite primary key (user_id, vocabulary_item_id) is
 * always set from that session's user id, never trusted from the caller.
 */
export async function saveWordProgress(progress: UserWordProgress): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { error } = await supabase.from('user_word_progress').upsert(
    {
      user_id: session.user.id,
      vocabulary_item_id: progress.vocabularyItemId,
      status: progress.status,
      familiarity: progress.familiarity,
      review_count: progress.reviewCount,
      recognition_count: progress.recognitionCount,
      last_reviewed_at: progress.lastReviewedAt ?? null,
      next_review_at: progress.nextReviewAt ?? null,
      needs_learn_reinforcement: progress.needsLearnReinforcement,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,vocabulary_item_id' },
  );

  if (error) {
    throw new Error('Failed to save word progress.');
  }
}

/**
 * Deletes progress rows for the given vocabulary item ids, scoped to the
 * current user. A no-op for an empty list — this never issues an unscoped
 * delete, and RLS is still the final authority regardless of this filter.
 */
export async function deleteWordProgress(vocabularyItemIds: string[]): Promise<void> {
  if (vocabularyItemIds.length === 0) {
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { error } = await supabase
    .from('user_word_progress')
    .delete()
    .eq('user_id', session.user.id)
    .in('vocabulary_item_id', vocabularyItemIds);

  if (error) {
    throw new Error('Failed to delete word progress.');
  }
}
