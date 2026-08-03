// Central home for every magic number used by the Learn/Review flow, so the
// scheduling and safety-cap rules in reviewSchedule.ts / learnSession.ts /
// reviewSession.ts never hardcode a number inline.

/** A Learn group's completion target: finish this many new words. */
export const LEARN_TARGET_COMPLETED = 10;

/** A word that has been shown this many times without completing graduates to Review. */
export const MAX_PRESENTATIONS_PER_WORD = 5;

/** The group always opens with this many distinct new words in a row, before any reinforcement task can interrupt. */
export const INITIAL_NEW_WORD_BOOTSTRAP_COUNT = 3;

/** Once bootstrap ends, at most this many new words can be shown back-to-back before an eligible reinforcement task must be inserted. */
export const MAX_CONSECUTIVE_NEW_CARDS = 2;

/** Anti-fatigue cap: stop introducing new words once this many distinct words have been seen. */
export const MAX_UNIQUE_SEEN_PER_GROUP = 15;

/** Anti-fatigue cap: end the group once this many cards have been shown in total. */
export const MAX_TOTAL_PRESENTATIONS_PER_GROUP = 50;

/** Consecutive "known" streak required to mark a word mastered. */
export const MAX_RECOGNITION_COUNT = 3;

/** A Review group never contains more than this many due words. */
export const REVIEW_GROUP_SIZE = 10;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** "unknown" always reschedules the word ten minutes out, in both Learn and Review. */
export const UNKNOWN_REVIEW_DELAY_MS = 10 * MINUTE_MS;

/** "fuzzy" always reschedules the word one day out, in both Learn and Review. */
export const FUZZY_REVIEW_DELAY_MS = 1 * DAY_MS;

/** "known" reschedules based on the resulting recognitionCount (1/2/3 -> 1/3/7 days). */
export const KNOWN_REVIEW_DELAY_MS_BY_RECOGNITION_COUNT: Record<number, number> = {
  1: 1 * DAY_MS,
  2: 3 * DAY_MS,
  3: 7 * DAY_MS,
};
