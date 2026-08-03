// In-memory session state for one Learn group or one Review group. These are
// pure data shapes — all transitions live in src/features/learning/*.ts as
// pure functions, never mutated directly by UI code.

/**
 * Why a Learn group stopped:
 * - 'completed-target': reached the 10-word completion goal.
 * - 'book-exhausted': the word book ran out of new words before reaching
 *   the goal — this is a normal, happy finish, not a fatigue pause.
 * - 'paused-unique-cap' / 'paused-presentation-cap': an anti-fatigue safety
 *   limit was hit before reaching the goal.
 */
export type LearnSessionEndReason =
  | 'completed-target'
  | 'book-exhausted'
  | 'paused-unique-cap'
  | 'paused-presentation-cap';

/**
 * A word that has been shown at least once but hasn't completed or
 * graduated yet, waiting to come back around as a "reinforcement" card.
 * `eligibleAfterPresentationCount` is the earliest totalPresentationCount
 * at which the scheduler is allowed to pick this task again — not a
 * guarantee it will be picked the instant it becomes eligible, since new
 * words and fairness among other eligible tasks still apply.
 */
export type ReinforcementTask = {
  wordId: string;
  eligibleAfterPresentationCount: number;
  /** Insertion order among reinforcement tasks, used to break ties between equally-eligible tasks so older ones never starve behind newer ones. */
  enqueueOrder: number;
};

/**
 * One rolling Learn group. There is no fixed "active window" — a single
 * scheduler (settleLearnSession) fairly interleaves two streams:
 * pendingWordIds (never-shown new words) and reinforcementQueue (shown but
 * not yet resolved words), always producing exactly one currentWordId.
 */
export type LearnSession = {
  wordBookId: string;
  /** Unique per group; used to detect a stale async result after the group ends or restarts. */
  sessionId: string;
  /** Not-yet-introduced new word ids, in the word book's stable order. */
  pendingWordIds: string[];
  /** Shown-but-unresolved words waiting to come back; at most one task per wordId. */
  reinforcementQueue: ReinforcementTask[];
  /** The word currently being displayed and judged. undefined only while the group is ending/ended. */
  currentWordId?: string;
  /** How many times each word has been presented so far this group. */
  presentationCounts: Record<string, number>;
  /** Every distinct word actually presented this group, in first-seen order. */
  seenWordIds: string[];
  /** Words that reached recognitionCount 3 (mastered) this group. */
  completedWordIds: string[];
  /** Difficult words that hit the per-word presentation cap (or were still unresolved when the group ended) and graduated to Review. */
  graduatedWordIds: string[];
  /** Total number of cards shown this group (can exceed uniqueSeenCount many times over). */
  totalPresentationCount: number;
  /** How many new (never-before-shown) words have been shown back-to-back since the last reinforcement card; resets to 0 whenever a reinforcement card is shown. */
  newCardsSinceLastReinforcement: number;
  /** Monotonic counter used to assign ReinforcementTask.enqueueOrder. */
  nextEnqueueOrder: number;
  unknownCount: number;
  fuzzyCount: number;
  knownCount: number;
  /** null while the group is still running. */
  endReason: LearnSessionEndReason | null;
};

export type LearnAnswerOutcome = 'reinforced' | 'completed' | 'graduated';

/** One Review group: at most REVIEW_GROUP_SIZE due words, each judged exactly once. */
export type ReviewSession = {
  wordBookId: string;
  sessionId: string;
  /** The group's starting size (<= REVIEW_GROUP_SIZE), kept for the summary screen. */
  totalCount: number;
  /** Not-yet-judged due word ids (front = the card being shown). */
  remainingQueue: string[];
  /** Words already judged this group, in the order they were judged. */
  reviewedWordIds: string[];
  unknownCount: number;
  fuzzyCount: number;
  knownCount: number;
};

export type ScreenMode = 'panel' | 'learn' | 'review';
