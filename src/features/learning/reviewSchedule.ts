import {
  FUZZY_REVIEW_DELAY_MS,
  KNOWN_REVIEW_DELAY_MS_BY_RECOGNITION_COUNT,
  MAX_RECOGNITION_COUNT,
  UNKNOWN_REVIEW_DELAY_MS,
} from '@/src/features/learning/constants';
import type { Familiarity, LearningStatus, UserWordProgress } from '@/src/types/vocabulary';

/**
 * Recognition-count semantics shared by Learn and Review: "known" advances
 * the streak (capped at MAX_RECOGNITION_COUNT), "unknown" resets it to zero,
 * "fuzzy" leaves it unchanged.
 */
export function nextRecognitionCount(
  familiarity: Familiarity,
  previousRecognitionCount: number,
): number {
  if (familiarity === 'known') {
    return Math.min(previousRecognitionCount + 1, MAX_RECOGNITION_COUNT);
  }
  if (familiarity === 'unknown') {
    return 0;
  }
  return previousRecognitionCount;
}

/** A word is mastered once its recognition streak reaches the cap, otherwise still learning. */
export function nextLearningStatus(recognitionCount: number): LearningStatus {
  return recognitionCount >= MAX_RECOGNITION_COUNT ? 'mastered' : 'learning';
}

/**
 * The next review time depends only on the choice just made and the
 * resulting recognitionCount — identical rule set for Learn and Review, so
 * both call this same function rather than duplicating the interval table.
 */
export function computeNextReviewAt(
  familiarity: Familiarity,
  recognitionCount: number,
  now: Date,
): string {
  const nowMs = now.getTime();

  if (familiarity === 'unknown') {
    return new Date(nowMs + UNKNOWN_REVIEW_DELAY_MS).toISOString();
  }
  if (familiarity === 'fuzzy') {
    return new Date(nowMs + FUZZY_REVIEW_DELAY_MS).toISOString();
  }

  const delay = KNOWN_REVIEW_DELAY_MS_BY_RECOGNITION_COUNT[recognitionCount] ?? FUZZY_REVIEW_DELAY_MS;
  return new Date(nowMs + delay).toISOString();
}

/**
 * A word counts as "new" for Learn when it has no progress row at all, or —
 * for forward compatibility — when a row exists with status still 'new'
 * AND shows no real review activity (reviewCount <= 0). This app's own
 * writes only ever save 'learning' or 'mastered', so this mainly guards
 * against rows created some other way.
 *
 * A 'new' row that DOES have reviewCount > 0 is an inconsistent/legacy
 * state (studied at least once, but never transitioned out of 'new'). By
 * rule, such a row is treated as already studied — not new — so it flows
 * into Review via isEligibleForReview instead of reappearing in Learn.
 * This is the single place that decision is made; isDueForReview and the
 * page-level filters must not re-derive it independently.
 *
 * A row with needsLearnReinforcement === true is a Learn carryover
 * regardless of what status/reviewCount say — this app's own writes never
 * produce that combination alongside status 'new', but the check is made
 * here (not in a page-level filter) so new/carryover/Review stay mutually
 * exclusive by construction even for a malformed/legacy row.
 */
export function isNewWord(progress: UserWordProgress | undefined): boolean {
  if (!progress) {
    return true;
  }
  if (progress.needsLearnReinforcement) {
    return false;
  }
  if (progress.status !== 'new') {
    return false;
  }
  return progress.reviewCount <= 0;
}

/**
 * A word counts as due for Review once it has real progress and its
 * nextReviewAt has passed. Missing or unparsable nextReviewAt (legacy rows
 * saved before this field was populated) are treated as due immediately,
 * so old data is never silently stuck out of Review forever.
 *
 * This is a pure time check only — it does not know about the new/due
 * mutual-exclusion rule. Callers that need "should this word ever be
 * offered in Review" must use isEligibleForReview instead, so a word still
 * considered new by isNewWord can never also satisfy isDueForReview's
 * missing-nextReviewAt fallback and show up in both Learn and Review.
 */
export function isDueForReview(progress: UserWordProgress, nowMs: number): boolean {
  const raw = progress.nextReviewAt;
  if (!raw) {
    return true;
  }
  const parsedMs = Date.parse(raw);
  if (Number.isNaN(parsedMs)) {
    return true;
  }
  return parsedMs <= nowMs;
}

/**
 * The single source of truth for "should this word be offered in Review
 * right now". Combines isNewWord and isDueForReview so the mutual
 * exclusion between Learn and Review is enforced in one place: a word
 * isNewWord() === true can never be eligible here, so the
 * missing/invalid-nextReviewAt compatibility fallback in isDueForReview
 * only ever applies to genuinely studied (learning/mastered, or
 * new-with-review-activity) rows.
 *
 * A word with needsLearnReinforcement === true is a Learn carryover: it
 * stays out of Review even once its nextReviewAt has passed, since it
 * belongs to the next Learn group instead. Only once it completes or
 * graduates (needsLearnReinforcement flips to false) can it become
 * eligible here.
 */
export function isEligibleForReview(progress: UserWordProgress | undefined, nowMs: number): boolean {
  if (!progress) {
    return false;
  }
  if (isNewWord(progress)) {
    return false;
  }
  if (progress.needsLearnReinforcement) {
    return false;
  }
  return isDueForReview(progress, nowMs);
}

/**
 * A word counts as a Learn carryover when it's an unresolved reinforcement
 * task from a previous Learn group: it has been shown but hasn't reached
 * the recognition streak, and hasn't hit the per-group presentation cap
 * either (that would have already flipped needsLearnReinforcement to
 * false). The recognitionCount check is defensive — this app's own writes
 * never set needsLearnReinforcement true alongside a completed streak.
 */
export function isLearnCarryover(progress: UserWordProgress | undefined): boolean {
  if (!progress) {
    return false;
  }
  if (!progress.needsLearnReinforcement) {
    return false;
  }
  return progress.recognitionCount < MAX_RECOGNITION_COUNT;
}

/**
 * Sorts carryover words by how long they've been waiting: earliest
 * lastReviewedAt first, missing/invalid timestamps sorting first of all.
 * Ties (including all-missing-timestamp cases) rely on Array.sort's
 * stability to fall back to the caller's original order, so passing an
 * already word-book-ordered array yields "same time -> word book order".
 */
export function compareByCarryoverOrder(
  aProgress: UserWordProgress | undefined,
  bProgress: UserWordProgress | undefined,
): number {
  const toSortableMs = (progress: UserWordProgress | undefined): number => {
    const raw = progress?.lastReviewedAt;
    if (!raw) {
      return Number.NEGATIVE_INFINITY;
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return toSortableMs(aProgress) - toSortableMs(bProgress);
}

/**
 * Sorts due words most-overdue-first. Missing/invalid nextReviewAt (legacy
 * data) sorts as if it were infinitely overdue, so it surfaces first.
 */
export function compareByReviewUrgency(
  aProgress: UserWordProgress | undefined,
  bProgress: UserWordProgress | undefined,
): number {
  const toSortableMs = (progress: UserWordProgress | undefined): number => {
    const raw = progress?.nextReviewAt;
    if (!raw) {
      return Number.NEGATIVE_INFINITY;
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return toSortableMs(aProgress) - toSortableMs(bProgress);
}
