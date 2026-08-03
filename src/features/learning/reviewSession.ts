import type { ReviewSession } from '@/src/types/learningSession';
import type { Familiarity } from '@/src/types/vocabulary';

/**
 * Creates a Review group from a caller-supplied list of due word ids
 * (already limited to REVIEW_GROUP_SIZE and sorted however the caller
 * likes — this module doesn't know about "due" at all). Review never
 * introduces new words, so there is no pending/active split like Learn.
 */
export function createReviewSession(
  wordBookId: string,
  sessionId: string,
  dueWordIdsInOrder: string[],
): ReviewSession {
  return {
    wordBookId,
    sessionId,
    totalCount: dueWordIdsInOrder.length,
    remainingQueue: [...dueWordIdsInOrder],
    reviewedWordIds: [],
    unknownCount: 0,
    fuzzyCount: 0,
    knownCount: 0,
  };
}

export function isReviewSessionComplete(session: ReviewSession): boolean {
  return session.remainingQueue.length === 0;
}

/**
 * Judges the word currently at the front of the queue and removes it —
 * unlike Learn, a Review group never re-presents a word within the same
 * group. Returns null if wordId is no longer at the front (a stale or
 * duplicate call), so the caller can safely ignore it.
 */
export function applyReviewAnswer(
  session: ReviewSession,
  wordId: string,
  familiarity: Familiarity,
): ReviewSession | null {
  if (session.remainingQueue[0] !== wordId) {
    return null;
  }

  return {
    ...session,
    remainingQueue: session.remainingQueue.slice(1),
    reviewedWordIds: [...session.reviewedWordIds, wordId],
    unknownCount: session.unknownCount + (familiarity === 'unknown' ? 1 : 0),
    fuzzyCount: session.fuzzyCount + (familiarity === 'fuzzy' ? 1 : 0),
    knownCount: session.knownCount + (familiarity === 'known' ? 1 : 0),
  };
}
