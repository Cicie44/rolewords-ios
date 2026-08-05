import {
  INITIAL_NEW_WORD_BOOTSTRAP_COUNT,
  LEARN_TARGET_COMPLETED,
  MAX_CONSECUTIVE_NEW_CARDS,
  MAX_PRESENTATIONS_PER_WORD,
  MAX_TOTAL_PRESENTATIONS_PER_GROUP,
  MAX_UNIQUE_WORDS_PER_GROUP,
} from '@/src/features/learning/constants';
import type {
  LearnAnswerOutcome,
  LearnSession,
  LearnSessionEndReason,
  ReinforcementTask,
} from '@/src/types/learningSession';
import type { Familiarity } from '@/src/types/vocabulary';

/**
 * The scheduler's fairness rule for reinforcement tasks: earliest-eligible
 * first, ties broken by insertion order — so an older difficult word can
 * never be starved behind a newer one that happens to share the same
 * eligibleAfterPresentationCount.
 */
function sortTasks(tasks: ReinforcementTask[]): ReinforcementTask[] {
  return [...tasks].sort(
    (a, b) => a.eligibleAfterPresentationCount - b.eligibleAfterPresentationCount || a.enqueueOrder - b.enqueueOrder,
  );
}

function eligibleTasks(session: LearnSession): ReinforcementTask[] {
  return sortTasks(
    session.reinforcementQueue.filter((task) => task.eligibleAfterPresentationCount <= session.totalPresentationCount),
  );
}

/** True once this wordId has actually been presented as a card this group (not merely queued). */
function hasBeenShownThisGroup(session: LearnSession, wordId: string): boolean {
  return session.seenWordIds.includes(wordId);
}

/**
 * How many distinct words this group has already committed to showing:
 * every word actually presented so far, plus every reinforcementQueue task
 * that hasn't been presented yet (carryover seeded at creation, or a
 * reinforcement task queued this group for a word not yet shown — which in
 * practice never happens, since a task is only ever created for a word
 * that was just presented). Combines presentationCounts and seenWordIds so
 * a task can never be double-counted once its word has actually appeared.
 * This — not seenWordIds.length alone — is what gates introducing a brand
 * new word, so carryover reserves its slots before it's ever shown.
 */
function reservedUniqueWordCount(session: LearnSession): number {
  const notYetShown = new Set<string>();
  for (const task of session.reinforcementQueue) {
    const alreadyShown =
      hasBeenShownThisGroup(session, task.wordId) || (session.presentationCounts[task.wordId] ?? 0) > 0;
    if (!alreadyShown) {
      notYetShown.add(task.wordId);
    }
  }
  return session.seenWordIds.length + notYetShown.size;
}

/**
 * Defensive filter: once seenWordIds has actually reached the unique-word
 * cap, drop any task that would introduce a brand-new distinct word (one
 * not yet shown this group) — reinforcing an already-shown word is always
 * safe and stays. This is a hard safety net independent of
 * reservedUniqueWordCount's bookkeeping: even a malformed session built
 * with more preseeded carryover than the cap allows can never have
 * presentCard show a word past the cap.
 */
function withinUniqueCap(session: LearnSession, tasks: ReinforcementTask[]): ReinforcementTask[] {
  if (session.seenWordIds.length < MAX_UNIQUE_WORDS_PER_GROUP) {
    return tasks;
  }
  return tasks.filter((task) => hasBeenShownThisGroup(session, task.wordId));
}

function evaluateGroupEnd(session: LearnSession): LearnSessionEndReason | null {
  if (session.completedWordIds.length >= LEARN_TARGET_COMPLETED) {
    return 'completed-target';
  }
  // Nothing left to introduce and nothing left to reinforce: the word book
  // ran out of new words before hitting the target. Normal finish, not a
  // fatigue pause.
  if (session.pendingWordIds.length === 0 && session.reinforcementQueue.length === 0) {
    return 'book-exhausted';
  }
  // Anti-fatigue cap on distinct words (new + carryover combined): once
  // seenWordIds has actually reached the cap, only keep going if some
  // remaining task is for a word already shown (safe to keep reinforcing).
  // A task for a word never shown this group can't be presented past the
  // cap (see withinUniqueCap), so if none remain, the group is genuinely
  // stuck on this dimension and must pause rather than loop forever.
  if (session.seenWordIds.length >= MAX_UNIQUE_WORDS_PER_GROUP) {
    const hasShowableTask = session.reinforcementQueue.some((task) => hasBeenShownThisGroup(session, task.wordId));
    if (!hasShowableTask) {
      return 'paused-unique-cap';
    }
  }
  // Hard ceiling on total card presentations, regardless of anything else.
  if (session.totalPresentationCount >= MAX_TOTAL_PRESENTATIONS_PER_GROUP) {
    return 'paused-presentation-cap';
  }
  return null;
}

/**
 * Decides whether the next card should be a brand-new word or a
 * reinforcement task, and which specific one — the single place the
 * new-word/reinforcement ratio and fairness rules live. Returns null only
 * when there is truly nothing left to show (which evaluateGroupEnd should
 * already have caught, making this an unreachable defensive case in
 * practice).
 */
function pickNextWordId(session: LearnSession): { wordId: string; source: 'new' | 'reinforcement' } | null {
  // A group that starts with carryover (reinforcementQueue pre-seeded before
  // any card has been shown) must show the earliest carryover word first,
  // rather than waiting behind a run of brand-new words. This can only be
  // true for the very first pick of the group: reinforcementQueue can't
  // otherwise be non-empty before totalPresentationCount advances past 0.
  if (session.totalPresentationCount === 0 && session.reinforcementQueue.length > 0) {
    const initialCandidates = withinUniqueCap(session, sortTasks(session.reinforcementQueue));
    if (initialCandidates.length > 0) {
      return { wordId: initialCandidates[0].wordId, source: 'reinforcement' };
    }
  }

  // Gates introducing a word this group has never committed to yet.
  // reservedUniqueWordCount (not seenWordIds.length) already counts
  // not-yet-shown carryover tasks, so new words can only fill the slots
  // carryover hasn't already reserved.
  const canIntroduceNewWord =
    session.pendingWordIds.length > 0 && reservedUniqueWordCount(session) < MAX_UNIQUE_WORDS_PER_GROUP;

  // Bootstrap: the first few distinct words of the group are always new,
  // unconditionally, so the learner has a pool of words to reinforce
  // before any reinforcement card can interrupt.
  if (session.seenWordIds.length < INITIAL_NEW_WORD_BOOTSTRAP_COUNT && canIntroduceNewWord) {
    return { wordId: session.pendingWordIds[0], source: 'new' };
  }

  const readyTasks = withinUniqueCap(session, eligibleTasks(session));

  // Ratio rule: once 2 new words have been shown back-to-back and an
  // eligible reinforcement task exists, it must be inserted next.
  const mustReinforceForFairness =
    readyTasks.length > 0 && session.newCardsSinceLastReinforcement >= MAX_CONSECUTIVE_NEW_CARDS;

  if (mustReinforceForFairness) {
    return { wordId: readyTasks[0].wordId, source: 'reinforcement' };
  }

  if (canIntroduceNewWord) {
    return { wordId: session.pendingWordIds[0], source: 'new' };
  }

  // Can't introduce a new word (unique-word cap reached, or no pending
  // words left). Use whatever reinforcement task is ready first.
  if (readyTasks.length > 0) {
    return { wordId: readyTasks[0].wordId, source: 'reinforcement' };
  }

  // No new word available and no task is eligible *yet* — but there is
  // nothing else that could ever advance totalPresentationCount to make
  // one eligible. Rather than stall or show a blank card, pull the
  // earliest-eligible task anyway (still sorted by the same fairness rule,
  // still filtered so a not-yet-shown task can't cross the unique cap).
  const fallbackCandidates = withinUniqueCap(session, sortTasks(session.reinforcementQueue));
  if (fallbackCandidates.length > 0) {
    return { wordId: fallbackCandidates[0].wordId, source: 'reinforcement' };
  }

  return null;
}

/**
 * Presenting a card is the only place seenWordIds, presentationCounts, and
 * totalPresentationCount are touched — a word that was only ever queued
 * (pending or reinforcement) but never actually chosen as currentWordId
 * can never be counted as "seen".
 */
function presentCard(session: LearnSession, wordId: string, source: 'new' | 'reinforcement'): LearnSession {
  const pendingWordIds = source === 'new' ? session.pendingWordIds.slice(1) : session.pendingWordIds;
  const reinforcementQueue =
    source === 'reinforcement'
      ? session.reinforcementQueue.filter((task) => task.wordId !== wordId)
      : session.reinforcementQueue;

  const seenWordIds = session.seenWordIds.includes(wordId) ? session.seenWordIds : [...session.seenWordIds, wordId];

  return {
    ...session,
    pendingWordIds,
    reinforcementQueue,
    currentWordId: wordId,
    presentationCounts: {
      ...session.presentationCounts,
      [wordId]: (session.presentationCounts[wordId] ?? 0) + 1,
    },
    seenWordIds,
    totalPresentationCount: session.totalPresentationCount + 1,
    newCardsSinceLastReinforcement: source === 'new' ? session.newCardsSinceLastReinforcement + 1 : 0,
  };
}

/**
 * Moves every word still waiting in reinforcementQueue — i.e. genuinely
 * shown this group but never resolved — into carryoverWordIds, so the next
 * Learn group keeps reinforcing them. This is distinct from graduation:
 * graduatedWordIds is only ever populated per-word in applyLearnAnswer,
 * when a word hits the per-group presentation cap without completing.
 * Words still in pendingWordIds were never shown and are deliberately left
 * untouched (they remain new). needsLearnReinforcement itself is already
 * persisted per answer, so finalizing never issues its own network
 * requests.
 */
export function finalizeLearnSession(session: LearnSession, endReason: LearnSessionEndReason): LearnSession {
  const completedSet = new Set(session.completedWordIds);
  const graduatedSet = new Set(session.graduatedWordIds);

  const newlyCarriedOver = session.reinforcementQueue
    .map((task) => task.wordId)
    .filter((wordId) => !completedSet.has(wordId) && !graduatedSet.has(wordId));
  const dedupedCarryover = Array.from(new Set([...session.carryoverWordIds, ...newlyCarriedOver]));

  return {
    ...session,
    endReason,
    currentWordId: undefined,
    reinforcementQueue: [],
    carryoverWordIds: dedupedCarryover,
  };
}

/**
 * The single scheduling entry point. Every transition — starting a group,
 * every judged answer, a word completing, a word graduating, hitting a
 * safety cap, or the word book running out — funnels through here, so
 * there is exactly one place that decides "is the group over" and "what's
 * the next card," never two divergent copies of that logic.
 */
export function settleLearnSession(session: LearnSession): LearnSession {
  const endReason = evaluateGroupEnd(session);
  if (endReason !== null) {
    return finalizeLearnSession(session, endReason);
  }

  const picked = pickNextWordId(session);
  if (!picked) {
    // Defensive only: evaluateGroupEnd returning null guarantees pendingWordIds
    // or reinforcementQueue is non-empty and under every cap, so pickNextWordId
    // always finds something in practice. This exists purely so a future change
    // can never leave endReason null with no currentWordId.
    return finalizeLearnSession(session, 'book-exhausted');
  }

  return presentCard(session, picked.wordId, picked.source);
}

/**
 * Creates a brand-new Learn group. `newWordIdsInOrder` must already be
 * filtered down to words with no real progress yet, in the word book's
 * stable order — this function does not consult progress itself, so the
 * caller decides what counts as "new".
 *
 * `carryoverWordIdsInOrder` are unresolved words from a previous Learn
 * group (needsLearnReinforcement === true), already sorted oldest-waiting
 * first by the caller. A single group can never show more than
 * MAX_UNIQUE_WORDS_PER_GROUP distinct words in total, so after a stable
 * de-dupe, only the first MAX_UNIQUE_WORDS_PER_GROUP entries are accepted
 * into this session — the rest are simply left out (their
 * needsLearnReinforcement row is never touched here) and remain available
 * for the caller to recompute and offer to a future group. Accepted
 * carryover is seeded as immediately-eligible reinforcement tasks
 * (eligibleAfterPresentationCount 0) with enqueueOrder continuing before
 * any new task created during play, so they share the same
 * eligibility/FIFO fairness as reinforcement tasks generated this group —
 * an old carryover can never be starved behind a newer one. presentationCounts
 * always restarts at 0 for every word this group, carryover included, so a
 * word can carry over multiple groups, each time getting its own fresh
 * MAX_PRESENTATIONS_PER_WORD budget before graduating.
 */
export function createLearnSession(
  wordBookId: string,
  sessionId: string,
  newWordIdsInOrder: string[],
  carryoverWordIdsInOrder: string[] = [],
): LearnSession {
  const dedupedCarryover: string[] = [];
  const seenCarryoverIds = new Set<string>();
  for (const wordId of carryoverWordIdsInOrder) {
    if (!seenCarryoverIds.has(wordId)) {
      seenCarryoverIds.add(wordId);
      dedupedCarryover.push(wordId);
    }
  }
  const acceptedCarryover = dedupedCarryover.slice(0, MAX_UNIQUE_WORDS_PER_GROUP);

  const carryoverTasks: ReinforcementTask[] = acceptedCarryover.map((wordId, index) => ({
    wordId,
    eligibleAfterPresentationCount: 0,
    enqueueOrder: index,
  }));

  const initialSession: LearnSession = {
    wordBookId,
    sessionId,
    pendingWordIds: [...newWordIdsInOrder],
    reinforcementQueue: carryoverTasks,
    currentWordId: undefined,
    presentationCounts: {},
    seenWordIds: [],
    completedWordIds: [],
    carryoverWordIds: [],
    graduatedWordIds: [],
    totalPresentationCount: 0,
    newCardsSinceLastReinforcement: 0,
    nextEnqueueOrder: carryoverTasks.length,
    unknownCount: 0,
    fuzzyCount: 0,
    knownCount: 0,
    endReason: null,
  };

  return settleLearnSession(initialSession);
}

export type LearnAnswerResult = {
  session: LearnSession;
  outcome: LearnAnswerOutcome;
};

/**
 * Applies the result of judging the current word. Returns null if the
 * group has already ended or wordId is no longer currentWordId (a
 * stale/duplicate call) — the caller should ignore the answer entirely in
 * that case rather than apply it.
 *
 * `isCompleted` must be computed by the caller from the resulting
 * recognitionCount (recognitionCount >= MAX_RECOGNITION_COUNT), since that
 * value depends on the word's persisted progress, which this module never
 * reads.
 */
export function applyLearnAnswer(
  session: LearnSession,
  wordId: string,
  familiarity: Familiarity,
  isCompleted: boolean,
): LearnAnswerResult | null {
  if (session.endReason !== null) {
    return null;
  }
  if (session.currentWordId !== wordId) {
    return null;
  }

  const presentationsSoFar = session.presentationCounts[wordId] ?? 0;

  let outcome: LearnAnswerOutcome;
  let completedWordIds = session.completedWordIds;
  let graduatedWordIds = session.graduatedWordIds;
  let reinforcementQueue = session.reinforcementQueue;
  let nextEnqueueOrder = session.nextEnqueueOrder;

  if (isCompleted) {
    outcome = 'completed';
    completedWordIds = [...completedWordIds, wordId];
  } else if (presentationsSoFar >= MAX_PRESENTATIONS_PER_WORD) {
    // Hit the per-word attempt cap without completing: graduate to Review
    // instead of letting this word occupy the group forever.
    outcome = 'graduated';
    graduatedWordIds = [...graduatedWordIds, wordId];
  } else {
    outcome = 'reinforced';
    const distance = familiarity === 'unknown' ? 1 : familiarity === 'fuzzy' ? 2 : 3;
    const task: ReinforcementTask = {
      wordId,
      eligibleAfterPresentationCount: session.totalPresentationCount + distance,
      enqueueOrder: nextEnqueueOrder,
    };
    reinforcementQueue = [...reinforcementQueue, task];
    nextEnqueueOrder += 1;
  }

  const nextSession: LearnSession = {
    ...session,
    currentWordId: undefined,
    reinforcementQueue,
    completedWordIds,
    graduatedWordIds,
    nextEnqueueOrder,
    unknownCount: session.unknownCount + (familiarity === 'unknown' ? 1 : 0),
    fuzzyCount: session.fuzzyCount + (familiarity === 'fuzzy' ? 1 : 0),
    knownCount: session.knownCount + (familiarity === 'known' ? 1 : 0),
  };

  return { session: settleLearnSession(nextSession), outcome };
}
