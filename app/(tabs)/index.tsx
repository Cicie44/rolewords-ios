import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  LEARN_TARGET_COMPLETED,
  MAX_PRESENTATIONS_PER_WORD,
  MAX_RECOGNITION_COUNT,
  REVIEW_GROUP_SIZE,
} from '@/src/features/learning/constants';
import { createLearnSession, applyLearnAnswer } from '@/src/features/learning/learnSession';
import { createReviewSession, applyReviewAnswer, isReviewSessionComplete } from '@/src/features/learning/reviewSession';
import {
  compareByCarryoverOrder,
  compareByReviewUrgency,
  computeNextReviewAt,
  isDueForReview,
  isEligibleForReview,
  isLearnCarryover,
  isNewWord,
  nextLearningStatus,
  nextRecognitionCount,
} from '@/src/features/learning/reviewSchedule';
import { useAuth } from '@/src/providers/AuthProvider';
import { playPronunciation } from '@/src/services/pronunciationService';
import {
  deleteSavedItem,
  fetchSavedItems,
  saveSavedItem,
} from '@/src/services/savedItemsService';
import {
  deleteWordProgress,
  fetchWordProgress,
  saveWordProgress,
} from '@/src/services/wordProgressService';
import {
  fetchGeneratedVocabularyByWordBookId,
  fetchVocabularyByWordBookId,
  fetchVocabularyExpansionSetting,
  fetchWordBooks,
  requestVocabularyExpansion,
  setVocabularyExpansionEnabled,
} from '@/src/services/vocabularyService';
import type { SavedItem, SavedItemType } from '@/src/types/savedItem';
import type { Familiarity, UserWordProgress, VocabularyItem, WordBook } from '@/src/types/vocabulary';
import type { LearnSession, ReviewSession, ScreenMode } from '@/src/types/learningSession';

// iOS-native, restrained palette: warm light-gray background, deep ink green
// as the primary color, a softer green for accents, a muted warm tone for
// "模糊", and system-gray neutrals. Scoped to this screen only.
const COLORS = {
  background: '#F6F3EE',
  surface: '#FFFFFF',
  ink: '#1E362F',
  inkSoft: '#4B6358',
  accent: '#48715F',
  accentSoft: '#E4EEE8',
  warm: '#B9814F',
  warmDark: '#8C5C2E',
  warmSoft: '#F5E9DA',
  gray: '#66666A',
  grayTrack: '#EDEAE4',
  border: '#E2DED7',
  danger: '#B3483F',
};

const CHOICES: { familiarity: Familiarity; label: string }[] = [
  { familiarity: 'unknown', label: '不认识' },
  { familiarity: 'fuzzy', label: '模糊' },
  { familiarity: 'known', label: '认识' },
];

// How long to wait, once, after a generation_in_progress response before
// quietly re-checking — never a repeating interval, and never more than one
// scheduled recheck at a time (see scheduleExpansionRecheck).
const EXPANSION_RECHECK_DELAY_MS = 20000;

type LoadState = 'loading' | 'loaded' | 'error';

function makeSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 'book-exhausted' is a normal, happy finish (the word book simply ran out
// of new words before the 10-word goal) — it must read the same as hitting
// the goal, never as a fatigue pause. Only the two 'paused-*' safety-cap
// reasons get the "paused" wording.
function learnSummaryTitle(endReason: LearnSession['endReason']): string {
  return endReason === 'completed-target' || endReason === 'book-exhausted' ? '本组完成' : '本组已暂停';
}

// A thin, purely decorative progress bar — the adjacent text already states
// the numbers, so this is hidden from screen readers rather than announced
// as an empty, unlabeled element.
function ProgressBar({ ratio, tone = 'accent' }: { ratio: number; tone?: 'accent' | 'warm' }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <View
      style={styles.progressTrack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View
        style={[
          styles.progressFill,
          tone === 'warm' ? styles.progressFillWarm : styles.progressFillAccent,
          { width: `${clamped * 100}%` },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared word card: used by both the Learn-active and Review-active screens
// so pronunciation, bookmarking, and the choice buttons only exist once.
// ---------------------------------------------------------------------------

type WordCardProps = {
  word: VocabularyItem;
  isGenerated: boolean;
  progressCurrent: number;
  progressTotal: number;
  progressLabel: string;
  onExit: () => void;
  exitDisabled: boolean;
  recognitionCount: number;
  isSaved: boolean;
  isBookmarkBusy: boolean;
  savedLoadState: LoadState;
  onRetrySavedLoad: () => void;
  onToggleBookmark: () => void;
  bookmarkError: string | null;
  isSaving: boolean;
  saveError: string | null;
  onChoice: (familiarity: Familiarity) => void;
};

function WordCard({
  word,
  isGenerated,
  progressCurrent,
  progressTotal,
  progressLabel,
  onExit,
  exitDisabled,
  recognitionCount,
  isSaved,
  isBookmarkBusy,
  savedLoadState,
  onRetrySavedLoad,
  onToggleBookmark,
  bookmarkError,
  isSaving,
  saveError,
  onChoice,
}: WordCardProps) {
  const progressRatio = progressTotal > 0 ? progressCurrent / progressTotal : 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardProgressGroup}>
          <Text style={styles.cardProgressText}>
            {progressLabel} {progressCurrent} / {progressTotal}
          </Text>
          <ProgressBar ratio={progressRatio} />
        </View>
        <Pressable
          onPress={onExit}
          disabled={exitDisabled}
          accessibilityRole="button"
          accessibilityLabel="退出本组，返回学习首页"
          hitSlop={8}
          style={[styles.exitButton, exitDisabled && styles.disabledOpacity]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor={COLORS.gray} size={16} />
        </Pressable>
      </View>

      <View style={styles.cardHeaderRow}>
        <Text style={styles.word} numberOfLines={2}>
          {word.term}
        </Text>
        <Pressable
          onPress={onToggleBookmark}
          disabled={isBookmarkBusy || savedLoadState !== 'loaded'}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? `取消收藏 ${word.term}` : `收藏 ${word.term}`}
          hitSlop={8}
          style={styles.bookmarkButton}>
          {isBookmarkBusy ? (
            <ActivityIndicator size="small" color={COLORS.ink} />
          ) : (
            <SymbolView
              name={{
                ios: isSaved ? 'bookmark.fill' : 'bookmark',
                android: isSaved ? 'bookmark' : 'bookmark_border',
                web: isSaved ? 'bookmark' : 'bookmark_border',
              }}
              tintColor={COLORS.ink}
              size={20}
            />
          )}
        </Pressable>
      </View>

      {isGenerated && (
        <View style={styles.generatedBadge}>
          <Text style={styles.generatedBadgeText}>AI 扩展</Text>
        </View>
      )}

      <View style={styles.pronunciationRow}>
        {word.ipa && (
          <View style={styles.ipaGroup}>
            <Text style={styles.ipa}>/{word.ipa}/</Text>
            <Text style={styles.accentBadge}>US</Text>
          </View>
        )}
        {word.partOfSpeech && <Text style={styles.partOfSpeech}>{word.partOfSpeech}</Text>}
        <Pressable
          onPress={() => playPronunciation(word.pronunciationText ?? word.term)}
          accessibilityRole="button"
          accessibilityLabel={`播放 ${word.term} 的发音`}
          hitSlop={8}
          style={styles.speakerButton}>
          <SymbolView
            name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
            tintColor={COLORS.accent}
            size={18}
          />
        </Pressable>
      </View>

      {savedLoadState === 'error' && (
        <View style={styles.bookmarkStatusRow}>
          <Text style={styles.statusText}>收藏状态加载失败</Text>
          <Pressable
            onPress={onRetrySavedLoad}
            accessibilityRole="button"
            accessibilityLabel="重试加载收藏状态"
            style={styles.smallRetryButton}>
            <Text style={styles.smallRetryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}
      {bookmarkError && <Text style={styles.errorText}>{bookmarkError}</Text>}

      <View style={styles.divider} />

      <View
        style={styles.recognitionRow}
        accessible
        accessibilityLabel={`认识进度 ${recognitionCount} / ${MAX_RECOGNITION_COUNT}`}>
        <Text style={styles.recognitionLabel}>认识进度</Text>
        <View style={styles.dotsRow}>
          {Array.from({ length: MAX_RECOGNITION_COUNT }).map((_, index) => (
            <View key={index} style={[styles.dot, index < recognitionCount && styles.dotFilled]} />
          ))}
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>中文释义</Text>
        <Text style={styles.meaning}>{word.chineseMeaning}</Text>
      </View>

      {word.englishDefinition && (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Definition</Text>
          <Text style={styles.example}>{word.englishDefinition}</Text>
        </View>
      )}

      {word.exampleSentence && (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Example</Text>
          <Text style={styles.example}>{word.exampleSentence}</Text>
        </View>
      )}

      {word.exampleTranslation && (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>翻译</Text>
          <Text style={styles.translation}>{word.exampleTranslation}</Text>
        </View>
      )}

      {saveError && <Text style={styles.errorText}>{saveError}</Text>}
      {isSaving && <Text style={styles.statusText}>正在保存…</Text>}

      <View style={styles.choiceRow}>
        {CHOICES.map(({ familiarity, label }) => (
          <Pressable
            key={familiarity}
            onPress={() => onChoice(familiarity)}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={`标记 ${word.term} 为${label}`}
            style={[
              styles.choiceButton,
              familiarity === 'unknown' && styles.choiceButtonNeutral,
              familiarity === 'fuzzy' && styles.choiceButtonWarm,
              familiarity === 'known' && styles.choiceButtonPrimary,
              isSaving && styles.disabledOpacity,
            ]}>
            <Text
              style={[
                styles.choiceButtonText,
                familiarity === 'unknown' && styles.choiceButtonTextNeutral,
                familiarity === 'fuzzy' && styles.choiceButtonTextWarm,
                familiarity === 'known' && styles.choiceButtonTextPrimary,
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function LearnScreen() {
  const { session: authSession } = useAuth();

  // Word books load first (there's no valid selectedWordBookId until they
  // do); vocabulary for the selected book loads independently and refetches
  // whenever the selection changes. All three loads — word books, progress,
  // and the selected book's vocabulary — are tracked separately so each can
  // fail, show its own retry, and succeed without the others.
  const [wordBooksState, setWordBooksState] = useState<WordBook[]>([]);
  const [wordBooksLoadState, setWordBooksLoadState] = useState<LoadState>('loading');
  const [wordBooksRetryToken, setWordBooksRetryToken] = useState(0);

  const [selectedWordBookId, setSelectedWordBookId] = useState<string | null>(null);

  // The public 500-word base catalog for the selected book — the "base
  // word library" the whole app's progress percentage and completion rules
  // are anchored to. Kept separate from the user's private AI-generated
  // words (below) so the two can be loaded, and reasoned about, independently.
  const [baseVocabularyItems, setBaseVocabularyItems] = useState<VocabularyItem[]>([]);
  const [vocabularyLoadState, setVocabularyLoadState] = useState<LoadState>('loading');
  const [vocabularyRetryToken, setVocabularyRetryToken] = useState(0);
  // Which word book id baseVocabularyItems / vocabularyLoadState's current
  // outcome actually belongs to. Effects fire asynchronously after a state
  // change commits, so there is a real render frame where
  // selectedWordBookId has already changed but the vocabulary-fetch effect
  // hasn't run yet — without these, that frame would render the *previous*
  // book's title/counts/buttons alongside baseVocabularyItems still holding
  // the previous book's items. Every place that reads baseVocabularyItems
  // for rendering must go through vocabularyLoadedForSelectedBook (folded
  // into dataReady) instead of trusting vocabularyLoadState alone.
  const [loadedVocabularyWordBookId, setLoadedVocabularyWordBookId] = useState<string | null>(null);
  const [vocabularyErrorWordBookId, setVocabularyErrorWordBookId] = useState<string | null>(null);
  // Guards against a slow, now-superseded fetch for a previously selected
  // word book overwriting the vocabulary of the word book the user has
  // since switched to.
  const vocabularyRequestTokenRef = useRef(0);

  // The current user's own private AI-generated words for the selected
  // book. Mirrors baseVocabularyItems' loading shape, but with one
  // deliberate difference: loadedGeneratedVocabularyWordBookId (the "do we
  // hold a trustworthy cache" marker) is only ever set by a *successful*
  // load and is never cleared by a subsequent failed refresh — see
  // generatedVocabularyAvailableForSelectedBook below, which is what
  // actually gates merging into wordsInBook. generatedVocabularyLoadState
  // separately tracks whether the most recent attempt is loading/loaded/
  // errored, purely for displaying a spinner or a retry affordance.
  // Returning 0 generated items is a perfectly normal, expected state
  // (unlike an empty base catalog, which is a data error).
  const [generatedVocabularyItems, setGeneratedVocabularyItems] = useState<VocabularyItem[]>([]);
  const [generatedVocabularyLoadState, setGeneratedVocabularyLoadState] = useState<LoadState>('loading');
  const [generatedVocabularyRetryToken, setGeneratedVocabularyRetryToken] = useState(0);
  const [loadedGeneratedVocabularyWordBookId, setLoadedGeneratedVocabularyWordBookId] = useState<string | null>(
    null,
  );
  // Paired with loadedGeneratedVocabularyWordBookId above: a trustworthy
  // cache belongs to one exact (userId, wordBookId) pair, never a
  // wordBookId alone — otherwise switching accounts while staying on the
  // same word book would keep reporting the previous account's cache as
  // available for the one render frame before the account-change effect
  // runs. Only ever set together with the wordBookId marker, on success.
  const [loadedGeneratedVocabularyUserId, setLoadedGeneratedVocabularyUserId] = useState<string | null>(null);
  const [generatedVocabularyErrorWordBookId, setGeneratedVocabularyErrorWordBookId] = useState<string | null>(null);
  const generatedVocabularyRequestTokenRef = useRef(0);

  // Whether the signed-in user has opted the selected book into AI daily
  // vocabulary expansion. Same cache-vs-attempt-status split as the
  // generated vocabulary above: loadedExpansionSettingWordBookId is only
  // ever set on success and never cleared by a failed refresh, so a stale
  // but trustworthy on/off state can still be shown (with an error+retry)
  // while a refresh is failing.
  const [expansionSettingEnabled, setExpansionSettingEnabled] = useState(false);
  const [expansionSettingLoadState, setExpansionSettingLoadState] = useState<LoadState>('loading');
  const [expansionSettingRetryToken, setExpansionSettingRetryToken] = useState(0);
  const [loadedExpansionSettingWordBookId, setLoadedExpansionSettingWordBookId] = useState<string | null>(null);
  // Same (userId, wordBookId) pairing as loadedGeneratedVocabularyUserId
  // above, for the same reason.
  const [loadedExpansionSettingUserId, setLoadedExpansionSettingUserId] = useState<string | null>(null);
  const [expansionSettingErrorWordBookId, setExpansionSettingErrorWordBookId] = useState<string | null>(null);
  const expansionSettingRequestTokenRef = useRef(0);

  // Saving the on/off toggle itself (distinct from isRequestingExpansion,
  // which tracks the generation call that immediately follows turning it on).
  const [isExpansionSettingSaving, setIsExpansionSettingSaving] = useState(false);
  const [expansionToggleError, setExpansionToggleError] = useState<string | null>(null);
  // Owner of the in-flight setting save — mirrors expansionInFlightRef's
  // ownership pattern below. isExpansionSettingSaving is a single shared
  // boolean (not itself scoped per account/book), so without this a save
  // that started for one account/book, finishing after the account-change
  // reset effect already let a *new* save start for a different
  // account/book, could clear isExpansionSettingSaving out from under that
  // new, still-in-flight save — surfacing it as "done" early and allowing a
  // duplicate submit while it's genuinely still saving.
  //
  // operationId gives every save call its own unique identity, distinct
  // from (userId, wordBookId): if the same user signs out and back in and
  // saves the setting again for the same word book, the old (still
  // in-flight) call and the new call share an identical userId/wordBookId
  // pair, so comparing only those two fields can't tell them apart — the
  // old call finishing would match the new call's ownership by coincidence
  // and incorrectly clear it. handleEnableExpansion/handlePauseExpansion
  // compare operationId (from expansionSettingSaveOperationIdRef, unique
  // per call), not userId/wordBookId, when deciding whether they still own
  // this slot.
  const expansionSettingSaveOwnerRef = useRef<{
    userId: string;
    wordBookId: string;
    operationId: number;
  } | null>(null);
  const expansionSettingSaveOperationIdRef = useRef(0);

  // Generation-request state. isRequestingExpansion is deliberately not
  // scoped to a particular word book by itself — combined at render time
  // with expansionInFlightRef (see isGeneratingSelectedExpansion below) so
  // switching away from, and back to, a book/user with a request genuinely
  // still in flight reports the right thing either way.
  const [isRequestingExpansion, setIsRequestingExpansion] = useState(false);
  const [isExpansionInProgress, setIsExpansionInProgress] = useState(false);
  const [isExpansionBacklogRemaining, setIsExpansionBacklogRemaining] = useState(false);
  const [expansionGenerationError, setExpansionGenerationError] = useState<string | null>(null);

  // Session-only "not right now" dismissal for the not-yet-enabled AI
  // expansion card — never persisted, and reset on every word-book switch
  // (see handleSelectWordBook) so it never silently follows the user to a
  // different book.
  const [dismissedExpansionCard, setDismissedExpansionCard] = useState(false);

  // At most one expansion request in flight at a time, globally — tracked
  // by userId and wordBookId (not wordBookId alone), since a stale request
  // from an account the user has since signed out of must never be mistaken
  // for "this word book is busy" once a different account selects the same
  // book. A ref (not state) because starting one must synchronously block a
  // concurrent duplicate.
  //
  // requestToken additionally gives every *call* its own unique identity,
  // distinct from (userId, wordBookId): if the same user signs out and back
  // in and starts a new request for the same word book, the old (still
  // in-flight) call and the new call share an identical userId/wordBookId
  // pair, so comparing only those two fields can't tell them apart — the
  // old call's completion would match the new call's ownership by pure
  // coincidence and incorrectly clear it. requestToken (from
  // expansionRequestTokenRef, already unique per call) is what runExpansionRequest's
  // finally block actually compares against to decide whether it still owns
  // this slot.
  const expansionInFlightRef = useRef<{ userId: string; wordBookId: string; requestToken: number } | null>(null);
  // Invalidates a stale request's result the moment a newer one starts, the
  // same technique vocabularyRequestTokenRef uses above.
  const expansionRequestTokenRef = useRef(0);
  // Records "already auto-attempted userId:wordBookId:UTC-date" so the
  // focus-driven effect below can never auto-fire the same day/user/book
  // combination twice, no matter how many times it re-evaluates. Keys embed
  // userId, so a different signed-in user's keys are already inert for the
  // new user — the user-change effect below additionally prunes old users'
  // entries so this Set doesn't grow forever across sign-outs.
  const autoExpansionAttemptedKeysRef = useRef<Set<string>>(new Set());
  // At most one pending delayed recheck after a generation_in_progress
  // response — never a repeating interval, and (per runExpansionRequest's
  // source parameter) a recheck itself is never allowed to schedule another.
  const expansionRecheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets async callbacks (the expansion request, the recheck timer, the
  // setting/vocabulary fetch effects) read the *current* user/selection/
  // screen/app-state instead of the value closed over when they started.
  const currentUserIdRef = useRef<string | null>(authSession?.user.id ?? null);
  const selectedWordBookIdRef = useRef<string | null>(selectedWordBookId);
  const screenModeRef = useRef<ScreenMode>('panel');
  const expansionSettingEnabledRef = useRef(false);

  // Mirrors React Navigation's screen-focus notion is not the same as the
  // OS-level app lifecycle — this tracks the latter (via React Native's
  // built-in AppState, no new dependency) so a request never fires while
  // the app itself is backgrounded, and a pending recheck timer gets
  // cancelled the moment it is.
  const [isAppActive, setIsAppActive] = useState(() => AppState.currentState === 'active');
  const isAppActiveRef = useRef(isAppActive);

  // Cancels a pending one-shot generation_in_progress recheck. Called from
  // every place that should invalidate it: pausing, switching word books,
  // an account change, leaving the panel screen, the app leaving the active
  // state, and unmount.
  const cancelExpansionRecheck = useCallback(() => {
    if (expansionRecheckTimeoutRef.current !== null) {
      clearTimeout(expansionRecheckTimeoutRef.current);
      expansionRecheckTimeoutRef.current = null;
    }
  }, []);

  const [progressByItemId, setProgressByItemId] = useState<Record<string, UserWordProgress>>({});
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [retryToken, setRetryToken] = useState(0);

  // The clock "due" checks are computed against. Deliberately a piece of
  // state (not a hidden Date.now() call inside a memo) so every place that
  // needs the due list to reflect the passage of time can explicitly
  // trigger a refresh — see refreshReviewNow and the nearest-due timer
  // effect below.
  const [reviewNowMs, setReviewNowMs] = useState(() => Date.now());
  const refreshReviewNow = useCallback(() => {
    setReviewNowMs(Date.now());
  }, []);

  const [screenMode, setScreenMode] = useState<ScreenMode>('panel');
  const [learnSession, setLearnSession] = useState<LearnSession | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);

  useEffect(() => {
    selectedWordBookIdRef.current = selectedWordBookId;
  }, [selectedWordBookId]);
  useEffect(() => {
    screenModeRef.current = screenMode;
    // Leaving the panel (entering an active Learn/Review session) must
    // never leave a delayed recheck timer that could fire mid-session.
    if (screenMode !== 'panel') {
      cancelExpansionRecheck();
    }
  }, [screenMode, cancelExpansionRecheck]);
  useEffect(() => {
    expansionSettingEnabledRef.current = expansionSettingEnabled;
  }, [expansionSettingEnabled]);
  // Redundant with the AppState listener below on every path that matters —
  // that listener now updates isAppActiveRef and cancels the recheck timer
  // synchronously, inside its own callback, before ever calling
  // setIsAppActive. This effect stays only as a backstop that keeps the ref
  // consistent with the state on any render path that isn't the listener
  // itself (e.g. the ref's own initial value), and is otherwise a no-op by
  // the time it runs.
  useEffect(() => {
    isAppActiveRef.current = isAppActive;
    if (!isAppActive) {
      cancelExpansionRecheck();
    }
  }, [isAppActive, cancelExpansionRecheck]);

  // React Native's built-in AppState — no new dependency. The listener
  // callback fires synchronously (outside React's render/commit cycle), so
  // isAppActiveRef and cancelExpansionRecheck() are applied *inside* it,
  // immediately, before setIsAppActive ever runs. Doing this the other way
  // around — relying solely on the isAppActive-driven effect above — would
  // leave a real gap between the OS actually backgrounding the app and
  // React committing the resulting re-render: during that gap
  // isAppActiveRef.current would still read stale-true, so a recheck timer
  // firing (or a manual button handler invoked) in that window could still
  // go through as if the app were active.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      isAppActiveRef.current = active;
      if (!active) {
        cancelExpansionRecheck();
      }
      setIsAppActive(active);
    });
    return () => {
      subscription.remove();
    };
  }, [cancelExpansionRecheck]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [savedLoadState, setSavedLoadState] = useState<LoadState>('loading');
  const [savedRetryToken, setSavedRetryToken] = useState(0);
  const [isBookmarkBusy, setIsBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);

  // Synchronous dedup lock for the current card's judgement, plus a
  // monotonic token that invalidates any in-flight async result once the
  // user leaves the session it belongs to (new group, return to panel,
  // word book switch, sign-out, or unmount).
  const handledAnswerKeyRef = useRef<string | null>(null);
  const sessionTokenRef = useRef(0);
  const lastAutoPlayedKeyRef = useRef<string | null>(null);

  const selectedWordBook = wordBooksState.find((book) => book.id === selectedWordBookId);

  // "Loaded" and "errored" are only trusted when they're tagged to the
  // currently selected book — see the comment on loadedVocabularyWordBookId
  // above. A stale 'loaded'/'error' left over from the previously selected
  // book (during the render frame before the fetch effect below has run)
  // counts as neither.
  const vocabularyLoadedForSelectedBook =
    vocabularyLoadState === 'loaded' &&
    selectedWordBookId !== null &&
    loadedVocabularyWordBookId === selectedWordBookId;
  const vocabularyErrorForSelectedBook =
    vocabularyLoadState === 'error' &&
    selectedWordBookId !== null &&
    vocabularyErrorWordBookId === selectedWordBookId;
  const vocabularyPendingForSelectedBook =
    wordBooksLoadState === 'loaded' &&
    wordBooksState.length > 0 &&
    loadState === 'loaded' &&
    selectedWordBookId !== null &&
    !vocabularyLoadedForSelectedBook &&
    !vocabularyErrorForSelectedBook;

  // Two deliberately separate concepts for the user's private generated
  // words:
  // - generatedVocabularyAvailableForSelectedBook: do we currently hold a
  //   *trustworthy cache* for the selected book, for the *currently signed-
  //   in user*. Only ever set true by a successful load (both
  //   loadedGeneratedVocabularyWordBookId and loadedGeneratedVocabularyUserId
  //   are never reset by a failed refresh — see the fetch effect above), so
  //   this stays true through a refresh's 'loading' or 'error' state and
  //   only ever goes false by switching to a book or account that hasn't
  //   loaded yet. This is what effectiveGeneratedVocabularyItems below gates
  //   on, so a refresh in flight or failing can never eject already-cached
  //   words from wordsInBook.
  // - generatedVocabularyLoadSucceededForSelectedBook: did the *most recent*
  //   attempt for this exact book specifically succeed. Used where a stale
  //   cache must not be trusted — e.g. the auto-trigger below requires a
  //   fresh confirmed load, not just "we have some cached data from before".
  // The userId comparison reads authSession?.user.id directly (not
  // currentUserIdRef) precisely because this is computed at render time: an
  // account switch invalidates both flags on the very first render after
  // authSession changes, without waiting for the account-change reset
  // effect below to actually run. Without it, switching accounts while
  // staying on the same word book would keep reporting the *previous*
  // account's cache as available/succeeded for one render frame, since
  // loadedGeneratedVocabularyWordBookId alone would still match.
  const generatedVocabularyAvailableForSelectedBook =
    selectedWordBookId !== null &&
    loadedGeneratedVocabularyWordBookId === selectedWordBookId &&
    loadedGeneratedVocabularyUserId === (authSession?.user.id ?? null);
  const generatedVocabularyLoadSucceededForSelectedBook =
    generatedVocabularyLoadState === 'loaded' && generatedVocabularyAvailableForSelectedBook;
  const generatedVocabularyErrorForSelectedBook =
    generatedVocabularyLoadState === 'error' &&
    selectedWordBookId !== null &&
    generatedVocabularyErrorWordBookId === selectedWordBookId;

  // Same cache-vs-attempt-status split as above, including the userId
  // comparison, for the expansion setting.
  const expansionSettingAvailableForSelectedBook =
    selectedWordBookId !== null &&
    loadedExpansionSettingWordBookId === selectedWordBookId &&
    loadedExpansionSettingUserId === (authSession?.user.id ?? null);
  const expansionSettingLoadSucceededForSelectedBook =
    expansionSettingLoadState === 'loaded' && expansionSettingAvailableForSelectedBook;
  const expansionSettingErrorForSelectedBook =
    expansionSettingLoadState === 'error' &&
    selectedWordBookId !== null &&
    expansionSettingErrorWordBookId === selectedWordBookId;

  // Every dataset needed to actually study must be in before the panel or
  // an active session can render — a book list without its vocabulary (or
  // vice versa) would show wrong or empty counts instead of a real error.
  // Deliberately does NOT require the generated-words or expansion-setting
  // fetches to have succeeded: AI expansion is an enhancement on top of the
  // base 500-word catalog, never a hard dependency for ordinary Learn/Review.
  const dataReady =
    wordBooksLoadState === 'loaded' &&
    wordBooksState.length > 0 &&
    loadState === 'loaded' &&
    vocabularyLoadedForSelectedBook &&
    selectedWordBook !== undefined;

  // Gated on *availability* (the cache marker), not on the most recent
  // attempt having succeeded — this is exactly what keeps already-loaded
  // generated words merged into wordsInBook while a refresh is loading or
  // has failed. See generatedVocabularyAvailableForSelectedBook's comment.
  const effectiveGeneratedVocabularyItems = generatedVocabularyAvailableForSelectedBook
    ? generatedVocabularyItems
    : [];

  // Base words first, generated words after — the single merged list every
  // existing Learn/Review derivation below reads, so the scheduler itself
  // never needs to know two sources exist.
  const wordsInBook = useMemo(
    () => [...baseVocabularyItems, ...effectiveGeneratedVocabularyItems],
    [baseVocabularyItems, effectiveGeneratedVocabularyItems],
  );

  const baseWordIdSet = useMemo(() => new Set(baseVocabularyItems.map((item) => item.id)), [baseVocabularyItems]);
  const generatedWordIdSet = useMemo(
    () => new Set(effectiveGeneratedVocabularyItems.map((item) => item.id)),
    [effectiveGeneratedVocabularyItems],
  );

  // Only ever covers the currently selected book's vocabulary — Learn and
  // Review sessions never reference a word from any other book, so this
  // never needs to be a global, all-books lookup.
  const vocabularyById = useMemo(() => new Map(wordsInBook.map((item) => [item.id, item])), [wordsInBook]);

  // The base progress percentage and "has the user finished the base
  // catalog" gate are both anchored to baseVocabularyItems specifically —
  // never wordsInBook — so generating (or later studying) AI words can
  // never move this number. See section three of the spec: 500/500 stays
  // 100% however many expansion words exist alongside it.
  const baseMasteredCount = baseVocabularyItems.filter(
    (item) => progressByItemId[item.id]?.status === 'mastered',
  ).length;

  // Display-only derived value (a rounded percentage of baseMasteredCount /
  // baseVocabularyItems.length) — no new business meaning, purely how the
  // existing ratio is presented on the progress bar/label.
  const baseMasteredPercent =
    baseVocabularyItems.length > 0 ? Math.round((baseMasteredCount / baseVocabularyItems.length) * 100) : 0;

  // New-word definition: no progress row at all (our own writes never save
  // status 'new', so this is effectively "never studied"). Scoped to the
  // base catalog only — this is "has the base 500 all entered learning",
  // the same rule the Edge Function itself uses to decide base_incomplete,
  // and it deliberately does not require mastery or an empty Review queue.
  const baseNewWordIds = useMemo(
    () => baseVocabularyItems.filter((item) => isNewWord(progressByItemId[item.id])).map((item) => item.id),
    [baseVocabularyItems, progressByItemId],
  );
  // Guarded by dataReady so an empty baseVocabularyItems array *before* it
  // has actually loaded can never look like "already fully studied".
  const isBaseFullyStudied = dataReady && baseNewWordIds.length === 0;

  // New-word definition for actually starting a Learn group: base and
  // generated new words combined — AI expansion words flow through the
  // exact same scheduler, never a second algorithm.
  const newWordIds = useMemo(
    () => wordsInBook.filter((item) => isNewWord(progressByItemId[item.id])).map((item) => item.id),
    [wordsInBook, progressByItemId],
  );

  // Carryover: words already shown in a previous Learn group that neither
  // completed nor graduated (needsLearnReinforcement === true). Sorted
  // oldest-waiting-first; Array.sort's stability makes ties fall back to
  // wordsInBook's own order, matching compareByCarryoverOrder's contract.
  const carryoverWordIds = useMemo(() => {
    return wordsInBook
      .filter((item) => isLearnCarryover(progressByItemId[item.id]))
      .sort((a, b) => compareByCarryoverOrder(progressByItemId[a.id], progressByItemId[b.id]))
      .map((item) => item.id);
  }, [wordsInBook, progressByItemId]);

  // Due-word definition: isEligibleForReview is the single source of truth
  // for "has real progress, isn't still new, and its nextReviewAt has
  // passed" — this keeps Learn and Review mutually exclusive by
  // construction instead of re-deriving the rule here. Driven by the
  // explicit reviewNowMs clock (never a hidden Date.now() call inside the
  // memo), so recomputation is fully controlled by when reviewNowMs itself
  // is refreshed.
  const dueWordIds = useMemo(() => {
    return wordsInBook
      .filter((item) => isEligibleForReview(progressByItemId[item.id], reviewNowMs))
      .map((item) => item.id)
      .sort((a, b) => compareByReviewUrgency(progressByItemId[a], progressByItemId[b]));
  }, [wordsInBook, progressByItemId, reviewNowMs]);

  const learnPhase: 'active' | 'summary' | null =
    screenMode === 'learn' && learnSession ? (learnSession.endReason === null ? 'active' : 'summary') : null;
  const reviewPhase: 'active' | 'summary' | null =
    screenMode === 'review' && reviewSession
      ? isReviewSessionComplete(reviewSession)
        ? 'summary'
        : 'active'
      : null;

  const currentWord: VocabularyItem | undefined = useMemo(() => {
    if (learnPhase === 'active' && learnSession) {
      return learnSession.currentWordId ? vocabularyById.get(learnSession.currentWordId) : undefined;
    }
    if (reviewPhase === 'active' && reviewSession) {
      const id = reviewSession.remainingQueue[0];
      return id ? vocabularyById.get(id) : undefined;
    }
    return undefined;
  }, [learnPhase, learnSession, reviewPhase, reviewSession]);

  const savedItemByContent = useMemo(() => {
    const map: Record<string, SavedItem> = {};
    for (const item of savedItems) {
      map[item.content] = item;
    }
    return map;
  }, [savedItems]);

  const currentSavedItem = currentWord ? savedItemByContent[currentWord.term] : undefined;
  const isCurrentWordSaved = Boolean(currentSavedItem);

  // Loads the current user's saved items. Independent of word-progress
  // loading — a failure here must never block studying. Refreshes every
  // time the Learn tab regains focus (e.g. after removing a bookmark from
  // the Saved tab).
  const loadSavedItems = useCallback(() => {
    let isActive = true;
    setSavedLoadState('loading');

    fetchSavedItems()
      .then((items) => {
        if (!isActive) return;
        setSavedItems(items);
        setSavedLoadState('loaded');
      })
      .catch(() => {
        if (!isActive) return;
        setSavedLoadState('error');
      });

    return () => {
      isActive = false;
    };
  }, [savedRetryToken]);

  useFocusEffect(loadSavedItems);

  // Requirement: refresh the due-time clock every time this tab regains
  // focus (e.g. the user left the app for a while and came back).
  useFocusEffect(
    useCallback(() => {
      refreshReviewNow();
    }, [refreshReviewNow]),
  );

  // Tracks which word is currently shown so async bookmark requests can tell
  // whether the user has already moved on by the time they settle, and
  // clears any bookmark error left over from the previous card.
  const currentWordIdRef = useRef<string | undefined>(currentWord?.id);
  useEffect(() => {
    currentWordIdRef.current = currentWord?.id;
    setBookmarkError(null);
  }, [currentWord?.id]);

  // Loads the word book catalog once a session is available. A different
  // signed-in user must never inherit a stale selection from the previous
  // one, so selectedWordBookId resets to null here — the success handler
  // below then defaults it to the first book, same as the previous
  // hardcoded `wordBooks[0].id` did, just resolved after the fetch instead
  // of at import time.
  useEffect(() => {
    const userId = authSession?.user.id;
    if (!userId) {
      return;
    }

    let isCancelled = false;
    setWordBooksLoadState('loading');
    setSelectedWordBookId(null);

    fetchWordBooks()
      .then((books) => {
        if (isCancelled) return;
        setWordBooksState(books);
        setWordBooksLoadState('loaded');
        setSelectedWordBookId(books[0]?.id ?? null);
      })
      .catch(() => {
        if (isCancelled) return;
        setWordBooksLoadState('error');
      });

    return () => {
      isCancelled = true;
    };
  }, [authSession?.user.id, wordBooksRetryToken]);

  // Loads the selected word book's vocabulary. Reruns whenever the
  // selection changes (or on retry) — the request token guards against a
  // slow fetch for a book the user has since switched away from
  // overwriting the vocabulary of the book now selected.
  useEffect(() => {
    if (!selectedWordBookId) {
      setBaseVocabularyItems([]);
      setLoadedVocabularyWordBookId(null);
      setVocabularyErrorWordBookId(null);
      return;
    }

    const requestToken = (vocabularyRequestTokenRef.current += 1);
    const requestedWordBookId = selectedWordBookId;
    setVocabularyLoadState('loading');

    fetchVocabularyByWordBookId(requestedWordBookId)
      .then((items) => {
        if (vocabularyRequestTokenRef.current !== requestToken) return;
        setBaseVocabularyItems(items);
        setLoadedVocabularyWordBookId(requestedWordBookId);
        setVocabularyErrorWordBookId(null);
        setVocabularyLoadState('loaded');
      })
      .catch(() => {
        if (vocabularyRequestTokenRef.current !== requestToken) return;
        setVocabularyErrorWordBookId(requestedWordBookId);
        setVocabularyLoadState('error');
      });
  }, [selectedWordBookId, vocabularyRetryToken]);

  // A different signed-in user (or sign-out) must never inherit the
  // previous user's private AI-expansion data, in-flight request, or
  // per-day attempt bookkeeping. Runs before the two fetch effects below
  // (declared first, and React runs effects in declaration order), so by
  // the time they see the new authSession?.user.id, currentUserIdRef is
  // already updated and every piece of stale expansion state is cleared.
  useEffect(() => {
    const userId = authSession?.user.id ?? null;
    currentUserIdRef.current = userId;

    generatedVocabularyRequestTokenRef.current += 1;
    expansionSettingRequestTokenRef.current += 1;
    expansionRequestTokenRef.current += 1;
    expansionInFlightRef.current = null;
    expansionSettingSaveOwnerRef.current = null;
    cancelExpansionRecheck();

    setGeneratedVocabularyItems([]);
    setLoadedGeneratedVocabularyWordBookId(null);
    setLoadedGeneratedVocabularyUserId(null);
    setGeneratedVocabularyErrorWordBookId(null);
    setGeneratedVocabularyLoadState('loading');

    setExpansionSettingEnabled(false);
    setLoadedExpansionSettingWordBookId(null);
    setLoadedExpansionSettingUserId(null);
    setExpansionSettingErrorWordBookId(null);
    setExpansionSettingLoadState('loading');

    setIsRequestingExpansion(false);
    setIsExpansionInProgress(false);
    setIsExpansionBacklogRemaining(false);
    setExpansionGenerationError(null);
    setExpansionToggleError(null);
    setIsExpansionSettingSaving(false);
    setDismissedExpansionCard(false);

    // Keys already embed userId, so a different user's old keys are
    // already inert for the new user — pruned here (rather than left to
    // accumulate forever across sign-outs) so this Set doesn't grow
    // unbounded over a long-lived app session with multiple accounts.
    if (userId) {
      const currentUserPrefix = `${userId}:`;
      for (const key of autoExpansionAttemptedKeysRef.current) {
        if (!key.startsWith(currentUserPrefix)) {
          autoExpansionAttemptedKeysRef.current.delete(key);
        }
      }
    } else {
      autoExpansionAttemptedKeysRef.current.clear();
    }
  }, [authSession?.user.id, cancelExpansionRecheck]);

  // Loads the current user's own AI-generated words for the selected book.
  // Same request-token/word-book-tagging shape as the base vocabulary fetch
  // above, plus an explicit userId check: a slow fetch from a since-signed-
  // out (or switched) account must never write into the current account's
  // page state, even if it happens to resolve after the account-change
  // effect above already reset everything. loadedGeneratedVocabularyWordBookId
  // is deliberately left untouched on failure (see the catch branch) — it
  // is the "do we hold a trustworthy cache" marker, and a failed refresh
  // must never erase an already-successful load; only a genuine account or
  // word-book switch (handled by the effects above) clears it.
  useEffect(() => {
    const userId = authSession?.user.id;
    if (!userId || !selectedWordBookId) {
      setGeneratedVocabularyItems([]);
      setLoadedGeneratedVocabularyWordBookId(null);
      setLoadedGeneratedVocabularyUserId(null);
      setGeneratedVocabularyErrorWordBookId(null);
      return;
    }

    const requestToken = (generatedVocabularyRequestTokenRef.current += 1);
    const requestedUserId = userId;
    const requestedWordBookId = selectedWordBookId;
    setGeneratedVocabularyLoadState('loading');

    fetchGeneratedVocabularyByWordBookId(requestedWordBookId)
      .then((items) => {
        if (
          generatedVocabularyRequestTokenRef.current !== requestToken ||
          currentUserIdRef.current !== requestedUserId ||
          selectedWordBookIdRef.current !== requestedWordBookId
        ) {
          return;
        }
        setGeneratedVocabularyItems(items);
        setLoadedGeneratedVocabularyWordBookId(requestedWordBookId);
        setLoadedGeneratedVocabularyUserId(requestedUserId);
        setGeneratedVocabularyErrorWordBookId(null);
        setGeneratedVocabularyLoadState('loaded');
      })
      .catch(() => {
        if (
          generatedVocabularyRequestTokenRef.current !== requestToken ||
          currentUserIdRef.current !== requestedUserId ||
          selectedWordBookIdRef.current !== requestedWordBookId
        ) {
          return;
        }
        setGeneratedVocabularyErrorWordBookId(requestedWordBookId);
        setGeneratedVocabularyLoadState('error');
      });
  }, [authSession?.user.id, selectedWordBookId, generatedVocabularyRetryToken]);

  // Loads whether the current user has AI daily expansion enabled for the
  // selected book. A missing row (never opted in yet) resolves to false via
  // fetchVocabularyExpansionSetting itself — this effect only distinguishes
  // "loaded" from "still loading" / "failed to load". Same cache-preserving
  // behavior on failure as the generated-vocabulary effect above:
  // loadedExpansionSettingWordBookId and the last-known expansionSettingEnabled
  // are left untouched by the catch branch, so a failed refresh shows an
  // error+retry without silently reverting a known "enabled" state to
  // "disabled". expansionSettingRetryToken lets the dedicated retry button
  // (shown when there is no trustworthy cache at all) force a fresh attempt.
  useEffect(() => {
    const userId = authSession?.user.id;
    if (!userId || !selectedWordBookId) {
      setLoadedExpansionSettingWordBookId(null);
      setLoadedExpansionSettingUserId(null);
      setExpansionSettingErrorWordBookId(null);
      return;
    }

    const requestToken = (expansionSettingRequestTokenRef.current += 1);
    const requestedUserId = userId;
    const requestedWordBookId = selectedWordBookId;
    setExpansionSettingLoadState('loading');

    fetchVocabularyExpansionSetting(requestedWordBookId)
      .then((enabled) => {
        if (
          expansionSettingRequestTokenRef.current !== requestToken ||
          currentUserIdRef.current !== requestedUserId ||
          selectedWordBookIdRef.current !== requestedWordBookId
        ) {
          return;
        }
        setExpansionSettingEnabled(enabled);
        setLoadedExpansionSettingWordBookId(requestedWordBookId);
        setLoadedExpansionSettingUserId(requestedUserId);
        setExpansionSettingErrorWordBookId(null);
        setExpansionSettingLoadState('loaded');
      })
      .catch(() => {
        if (
          expansionSettingRequestTokenRef.current !== requestToken ||
          currentUserIdRef.current !== requestedUserId ||
          selectedWordBookIdRef.current !== requestedWordBookId
        ) {
          return;
        }
        setExpansionSettingErrorWordBookId(requestedWordBookId);
        setExpansionSettingLoadState('error');
      });
  }, [authSession?.user.id, selectedWordBookId, expansionSettingRetryToken]);

  // Loads remote progress once a session is available. Also resets every
  // piece of active-session state back to the control panel: a different
  // signed-in user (or a manual retry) must never inherit another user's
  // in-progress Learn/Review group.
  useEffect(() => {
    const userId = authSession?.user.id;
    if (!userId) {
      return;
    }

    let isCancelled = false;
    setLoadState('loading');
    sessionTokenRef.current += 1;
    handledAnswerKeyRef.current = null;
    lastAutoPlayedKeyRef.current = null;
    setScreenMode('panel');
    setLearnSession(null);
    setReviewSession(null);
    setIsSaving(false);
    setSaveError(null);
    setReviewNowMs(Date.now());

    fetchWordProgress()
      .then((remoteProgress) => {
        if (isCancelled) return;
        setProgressByItemId(remoteProgress);
        setLoadState('loaded');
      })
      .catch(() => {
        if (isCancelled) return;
        setLoadState('error');
      });

    return () => {
      isCancelled = true;
    };
  }, [authSession?.user.id, retryToken]);

  // Invalidates any in-flight save the moment this screen unmounts, so its
  // result can never be applied to state that no longer exists.
  useEffect(() => {
    return () => {
      sessionTokenRef.current += 1;
    };
  }, []);

  // Auto-plays each new card's pronunciation exactly once, for either mode.
  // The ref guard (rather than the dependency array alone) protects against
  // React re-running this effect for the same card, e.g. under Strict
  // Mode's double-invocation in development.
  useEffect(() => {
    if (loadState !== 'loaded' || !currentWord) {
      return;
    }

    const key =
      learnPhase === 'active' && learnSession
        ? `learn:${learnSession.sessionId}:${learnSession.totalPresentationCount}:${currentWord.id}`
        : reviewPhase === 'active' && reviewSession
          ? `review:${reviewSession.sessionId}:${reviewSession.reviewedWordIds.length}:${currentWord.id}`
          : null;

    if (!key || lastAutoPlayedKeyRef.current === key) {
      return;
    }
    lastAutoPlayedKeyRef.current = key;

    void playPronunciation(currentWord.pronunciationText ?? currentWord.term);
  }, [loadState, learnPhase, learnSession, reviewPhase, reviewSession, currentWord]);

  // Requirement: while sitting on the control panel with at least one word
  // that is eligible for Review but not due *yet*, schedule a one-shot
  // timer that refreshes reviewNowMs right as the nearest one becomes due,
  // so the Review count updates itself without the user having to leave
  // and come back. A small tolerance avoids firing a moment too early on
  // the exact due instant. Recomputed whenever progress changes (a fresh
  // answer may set a new nearest due time), the panel becomes visible, or
  // reviewNowMs itself changes — the last one is what makes this
  // self-chaining: once the nearest word's timer fires and bumps
  // reviewNowMs, this effect reruns, rescans with a fresh Date.now(), and
  // schedules the *next* nearest future due word (if any). That rescan
  // always excludes words that just became due, so a fired timer can never
  // immediately reschedule itself — only a genuinely different, still
  // in the future word ever gets a new timer. Deliberately does nothing
  // outside the panel screen, and the returned cleanup always cancels the
  // pending timeout, so it can never fire (and call setState) after this
  // effect reruns or the component unmounts.
  useEffect(() => {
    if (loadState !== 'loaded' || screenMode !== 'panel') {
      return;
    }

    const nowMs = Date.now();
    let nearestFutureDueMs: number | null = null;

    for (const item of wordsInBook) {
      const progress = progressByItemId[item.id];
      if (!progress || isNewWord(progress) || isDueForReview(progress, nowMs)) {
        continue;
      }
      const raw = progress.nextReviewAt;
      if (!raw) continue;
      const parsedMs = Date.parse(raw);
      if (Number.isNaN(parsedMs)) continue;
      if (nearestFutureDueMs === null || parsedMs < nearestFutureDueMs) {
        nearestFutureDueMs = parsedMs;
      }
    }

    if (nearestFutureDueMs === null) {
      return;
    }

    const DUE_TIMER_TOLERANCE_MS = 1000;
    const delayMs = Math.max(0, nearestFutureDueMs - Date.now() + DUE_TIMER_TOLERANCE_MS);
    const timeoutId = setTimeout(() => {
      setReviewNowMs(Date.now());
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [loadState, screenMode, wordsInBook, progressByItemId, reviewNowMs]);

  const handleSelectWordBook = (bookId: string) => {
    if (isRestarting) return;
    setSelectedWordBookId(bookId);
    setSaveError(null);
    setRestartError(null);
    refreshReviewNow();
    // A pending delayed recheck belongs to the book being left — it must
    // never fire (and possibly re-trigger a UI update) for a book the user
    // has already navigated away from.
    cancelExpansionRecheck();
    // Per-book transient AI-expansion display state — never carried over to
    // whichever book is selected next. The underlying data fetches (and
    // their own loaded-for-this-book flags) are handled by their own effects.
    setDismissedExpansionCard(false);
    setIsExpansionInProgress(false);
    setIsExpansionBacklogRemaining(false);
    setExpansionGenerationError(null);
    setExpansionToggleError(null);
  };

  const handleToggleBookmark = async () => {
    if (!currentWord || isBookmarkBusy || savedLoadState !== 'loaded') {
      return;
    }

    // Captured so that if the user moves to another card before this
    // request settles, a failure can still finish the request normally
    // without displaying its error on the wrong (now-current) card.
    const requestWordId = currentWord.id;

    setIsBookmarkBusy(true);
    setBookmarkError(null);

    if (currentSavedItem) {
      try {
        await deleteSavedItem(currentSavedItem.id);
      } catch {
        if (currentWordIdRef.current === requestWordId) {
          setBookmarkError('取消收藏失败，请检查网络后重试。');
        }
        setIsBookmarkBusy(false);
        return;
      }

      setSavedItems((prev) => prev.filter((item) => item.id !== currentSavedItem.id));
    } else {
      const trimmedTerm = currentWord.term.trim();
      const itemType: SavedItemType = /\s/.test(trimmedTerm) ? 'phrase' : 'word';

      let saved: SavedItem;
      try {
        saved = await saveSavedItem({
          itemType,
          content: currentWord.term,
          chineseText: currentWord.chineseMeaning,
          sourceType: 'learning',
          sourceId: currentWord.id,
        });
      } catch {
        if (currentWordIdRef.current === requestWordId) {
          setBookmarkError('收藏失败，请检查网络后重试。');
        }
        setIsBookmarkBusy(false);
        return;
      }

      setSavedItems((prev) => [saved, ...prev]);
    }

    setIsBookmarkBusy(false);
  };

  // Shared save-then-advance core for both Learn and Review: compute the
  // new progress, persist it first, and only touch session state once the
  // save has actually succeeded — exactly the ordering the app already
  // relies on elsewhere for reliability.
  const submitAnswer = async (
    familiarity: Familiarity,
    applyToSession: (recognitionCount: number) => void,
    deriveNeedsLearnReinforcement: (recognitionCount: number) => boolean,
  ) => {
    if (!currentWord) return;

    const wordId = currentWord.id;
    const now = new Date();
    const previous = progressByItemId[wordId];
    const recognitionCount = nextRecognitionCount(familiarity, previous?.recognitionCount ?? 0);
    const status = nextLearningStatus(recognitionCount);
    const nextReviewAt = computeNextReviewAt(familiarity, recognitionCount, now);
    const needsLearnReinforcement = deriveNeedsLearnReinforcement(recognitionCount);

    const nextProgress: UserWordProgress = {
      vocabularyItemId: wordId,
      status,
      familiarity,
      recognitionCount,
      reviewCount: (previous?.reviewCount ?? 0) + 1,
      lastReviewedAt: now.toISOString(),
      nextReviewAt,
      needsLearnReinforcement,
    };

    const requestToken = sessionTokenRef.current;

    setIsSaving(true);
    setSaveError(null);

    try {
      await saveWordProgress(nextProgress);
    } catch {
      if (sessionTokenRef.current === requestToken) {
        // Reset the guard so the same card can be retried.
        handledAnswerKeyRef.current = null;
        setSaveError('进度保存失败，请检查网络后重试。');
        setIsSaving(false);
      }
      return;
    }

    if (sessionTokenRef.current !== requestToken) {
      // The user already left this session (new group / returned to panel /
      // switched word book / signed out) — the save still succeeded and
      // persisted, but must not be applied to state that no longer exists.
      return;
    }

    setProgressByItemId((prev) => ({ ...prev, [wordId]: nextProgress }));
    applyToSession(recognitionCount);
    setIsSaving(false);
  };

  const handleLearnChoice = async (familiarity: Familiarity) => {
    if (!currentWord || isSaving || !learnSession || learnSession.endReason !== null) {
      return;
    }

    const key = `learn:${learnSession.sessionId}:${learnSession.totalPresentationCount}:${currentWord.id}`;
    if (handledAnswerKeyRef.current === key) {
      return;
    }
    handledAnswerKeyRef.current = key;

    const wordId = currentWord.id;
    const activeSessionId = learnSession.sessionId;
    // How many times this card has already been shown this group — the
    // same value applyLearnAnswer uses to decide 'reinforced' vs
    // 'graduated' — so the persisted needsLearnReinforcement flag always
    // agrees with the in-memory scheduling outcome.
    const presentationsSoFar = learnSession.presentationCounts[wordId] ?? 0;

    await submitAnswer(
      familiarity,
      (recognitionCount) => {
        setLearnSession((prev) => {
          if (!prev || prev.sessionId !== activeSessionId) return prev;
          const result = applyLearnAnswer(prev, wordId, familiarity, recognitionCount >= MAX_RECOGNITION_COUNT);
          return result ? result.session : prev;
        });
      },
      (recognitionCount) =>
        recognitionCount < MAX_RECOGNITION_COUNT && presentationsSoFar < MAX_PRESENTATIONS_PER_WORD,
    );
  };

  const handleReviewChoice = async (familiarity: Familiarity) => {
    if (!currentWord || isSaving || !reviewSession || isReviewSessionComplete(reviewSession)) {
      return;
    }

    const key = `review:${reviewSession.sessionId}:${reviewSession.reviewedWordIds.length}:${currentWord.id}`;
    if (handledAnswerKeyRef.current === key) {
      return;
    }
    handledAnswerKeyRef.current = key;

    const wordId = currentWord.id;
    const activeSessionId = reviewSession.sessionId;

    await submitAnswer(
      familiarity,
      () => {
        setReviewSession((prev) => {
          if (!prev || prev.sessionId !== activeSessionId) return prev;
          const result = applyReviewAnswer(prev, wordId, familiarity);
          return result ?? prev;
        });
      },
      () => false,
    );
  };

  const handleStartLearn = () => {
    if (!selectedWordBookId || isSaving || (newWordIds.length === 0 && carryoverWordIds.length === 0)) return;
    sessionTokenRef.current += 1;
    handledAnswerKeyRef.current = null;
    lastAutoPlayedKeyRef.current = null;
    setSaveError(null);
    setReviewSession(null);
    setLearnSession(createLearnSession(selectedWordBookId, makeSessionId('learn'), newWordIds, carryoverWordIds));
    setScreenMode('learn');
  };

  const handleStartReview = () => {
    if (!selectedWordBookId || isSaving || dueWordIds.length === 0) return;
    sessionTokenRef.current += 1;
    handledAnswerKeyRef.current = null;
    lastAutoPlayedKeyRef.current = null;
    setSaveError(null);
    setLearnSession(null);
    setReviewSession(
      createReviewSession(selectedWordBookId, makeSessionId('review'), dueWordIds.slice(0, REVIEW_GROUP_SIZE)),
    );
    setScreenMode('review');
  };

  const handleReturnToPanel = () => {
    if (isSaving) return;
    sessionTokenRef.current += 1;
    handledAnswerKeyRef.current = null;
    lastAutoPlayedKeyRef.current = null;
    setLearnSession(null);
    setReviewSession(null);
    setSaveError(null);
    setScreenMode('panel');
    refreshReviewNow();
  };

  const handleRestartWordBook = async () => {
    if (isRestarting || isSaving) return;

    setIsRestarting(true);
    setRestartError(null);

    try {
      await deleteWordProgress(wordsInBook.map((item) => item.id));
    } catch {
      setRestartError('重置失败，请检查网络后重试。');
      setIsRestarting(false);
      return;
    }

    setProgressByItemId((prev) => {
      const next = { ...prev };
      for (const item of wordsInBook) {
        delete next[item.id];
      }
      return next;
    });

    setIsRestarting(false);
  };

  // A destructive, whole-word-book action now lives on the main control
  // panel, so a mis-tap is more likely than when it was buried at the
  // bottom of a finished round — require an explicit native confirmation
  // before the actual deletion runs. The guard here (in addition to the
  // one inside handleRestartWordBook) also stops a second tap from
  // re-opening the dialog while a reset is already in flight.
  const handleRequestRestartWordBook = () => {
    if (isRestarting || isSaving) return;

    Alert.alert('重新学习整本词书？', '这会清空该词书的全部学习和复习进度，且无法在 App 内撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空并重新学习',
        style: 'destructive',
        onPress: () => {
          void handleRestartWordBook();
        },
      },
    ]);
  };

  // The one place that calls generate-vocabulary-expansion, shared by the
  // auto-trigger effect, the "开启" flow, the manual "重试"/"刷新状态"
  // button, and the one-shot generation_in_progress recheck — so there is
  // exactly one implementation of "start a request, apply its result,
  // discard it if stale" rather than a copy per call site. Guarded so only
  // one expansion request is ever in flight at a time, globally.
  //
  // `source` distinguishes a delayed recheck from a fresh auto/manual
  // attempt: only a fresh attempt is allowed to schedule *another* recheck
  // if it, too, comes back generation_in_progress — a recheck can never
  // schedule a further recheck, which is what actually caps polling at one
  // extra check instead of an unbounded chain.
  const runExpansionRequest = useCallback(
    async (wordBookId: string, source: 'auto' | 'manual' | 'delayed-recheck') => {
      const requestedUserId = currentUserIdRef.current;
      if (!requestedUserId) {
        return;
      }
      if (!isAppActiveRef.current) {
        return;
      }
      if (expansionInFlightRef.current !== null) {
        return;
      }

      // Recorded synchronously, before the request is even sent, so the
      // focus-driven auto-trigger effect can never fire a second time for
      // this same user/book/day even if it re-evaluates while this request
      // is still in flight.
      const utcDate = new Date().toISOString().slice(0, 10);
      autoExpansionAttemptedKeysRef.current.add(`${requestedUserId}:${wordBookId}:${utcDate}`);

      const requestToken = (expansionRequestTokenRef.current += 1);
      expansionInFlightRef.current = { userId: requestedUserId, wordBookId, requestToken };
      setIsRequestingExpansion(true);

      // A result only gets applied to book-specific display state when
      // this is still the newest request, for the same account, and the
      // user hasn't since switched to a different book — a stale or
      // now-irrelevant result is silently discarded rather than ever
      // overwriting what's currently shown (e.g. a different account's
      // data, or a book the user has navigated away from).
      const stillRelevant = () =>
        expansionRequestTokenRef.current === requestToken &&
        currentUserIdRef.current === requestedUserId &&
        selectedWordBookIdRef.current === wordBookId;

      if (stillRelevant()) {
        setExpansionGenerationError(null);
        setIsExpansionBacklogRemaining(false);
        setIsExpansionInProgress(false);
      }

      try {
        const response = await requestVocabularyExpansion(wordBookId);

        if (response.status === 'disabled') {
          // Not an error — the server-side setting disagrees with what this
          // page has locally (e.g. paused from another device); sync to it.
          if (stillRelevant()) {
            setExpansionSettingEnabled(false);
          }
          return;
        }

        if (response.status === 'base_incomplete') {
          // Not an error — nothing to show here; the base progress card
          // already reflects this on its own.
          return;
        }

        if (response.status === 'backlog_remaining') {
          if (stillRelevant()) {
            setIsExpansionBacklogRemaining(true);
          }
          return;
        }

        if (response.status === 'generation_in_progress') {
          if (stillRelevant()) {
            setIsExpansionInProgress(true);
            if (source !== 'delayed-recheck') {
              scheduleExpansionRecheck(requestedUserId, wordBookId);
            }
          }
          return;
        }

        // generated / already_generated: the response's own items are never
        // trusted as the page's data source — re-querying the database is
        // what actually updates generatedVocabularyItems.
        const refreshedItems = await fetchGeneratedVocabularyByWordBookId(wordBookId);
        if (stillRelevant()) {
          setGeneratedVocabularyItems(refreshedItems);
          setLoadedGeneratedVocabularyWordBookId(wordBookId);
          setLoadedGeneratedVocabularyUserId(requestedUserId);
          setGeneratedVocabularyErrorWordBookId(null);
          setGeneratedVocabularyLoadState('loaded');
          setIsExpansionBacklogRemaining(false);
          setIsExpansionInProgress(false);
          setExpansionGenerationError(null);
        }
      } catch {
        if (stillRelevant()) {
          setExpansionGenerationError('扩展词准备失败，请稍后重试。');
        }
      } finally {
        // Ownership check, not stillRelevant(): expansionInFlightRef can be
        // forcibly cleared out from under this call by the account-change
        // reset effect (it cannot cancel this in-flight await, only stop
        // trusting its result), which lets a *new* request for a different
        // account/book claim the slot while this one is still winding down.
        // If that happened, expansionInFlightRef.current now belongs to
        // that newer request — this call must touch neither the ref nor
        // isRequestingExpansion, or it would clear the newer request's
        // genuinely-still-in-flight loading state out from under it (and
        // isRequestingExpansion is a single boolean shared across every
        // account/book, not scoped to this one call).
        //
        // Compares requestToken, not (userId, wordBookId): if the same user
        // signs out and back in and starts a new request for the same word
        // book, the new request's userId and wordBookId are identical to
        // this (old, still in-flight) call's — a userId+wordBookId
        // comparison alone would match by coincidence and incorrectly clear
        // the newer request's slot. requestToken gives every call, even one
        // with an otherwise-identical userId/wordBookId pair, its own unique
        // identity, so only the call that actually owns this exact slot ever
        // clears it.
        if (expansionInFlightRef.current !== null && expansionInFlightRef.current.requestToken === requestToken) {
          expansionInFlightRef.current = null;
          setIsRequestingExpansion(false);
        }
      }
    },
    // Intentionally stable (no reactive dependencies): every value it reads
    // that could change over time is read through a ref at call time
    // instead, so this identity never needs to change across renders.
    [],
  );

  // At most one pending timer — a second call while one is already
  // scheduled is a no-op, never a stacked/repeating timer. Combined with
  // runExpansionRequest's source check above, this is what caps
  // generation_in_progress polling at exactly one extra recheck, never an
  // unbounded chain: only a fresh auto/manual attempt schedules a recheck,
  // and the recheck itself always passes source: 'delayed-recheck', which
  // is forbidden from scheduling another.
  const scheduleExpansionRecheck = useCallback(
    (userId: string, wordBookId: string) => {
      if (expansionRecheckTimeoutRef.current !== null) {
        return;
      }
      expansionRecheckTimeoutRef.current = setTimeout(() => {
        expansionRecheckTimeoutRef.current = null;
        // Every value here is read fresh from a ref, never a closed-over
        // variable, so this can't act on a stale userId/wordBookId/enabled
        // value from whenever the timer was originally scheduled.
        if (
          isAppActiveRef.current &&
          screenModeRef.current === 'panel' &&
          currentUserIdRef.current === userId &&
          selectedWordBookIdRef.current === wordBookId &&
          expansionSettingEnabledRef.current &&
          expansionInFlightRef.current === null
        ) {
          void runExpansionRequest(wordBookId, 'delayed-recheck');
        }
      }, EXPANSION_RECHECK_DELAY_MS);
    },
    [runExpansionRequest],
  );

  // Cancels a pending one-shot recheck on unmount, so it can never fire (and
  // call setState) after this screen is gone.
  useEffect(() => {
    return () => {
      cancelExpansionRecheck();
    };
  }, [cancelExpansionRecheck]);

  // Auto-trigger: re-evaluated every time this screen regains focus, or
  // whenever any of its own dependencies change while already focused
  // (useFocusEffect re-invokes its callback on either) — including the app
  // returning to the active state. Actually starting a request is still
  // gated by autoExpansionAttemptedKeysRef, which is what guarantees at
  // most one automatic attempt per signed-in user, per word book, per UTC
  // calendar day — no matter how many times this re-runs.
  useFocusEffect(
    useCallback(() => {
      if (!isAppActive) return;
      if (screenMode !== 'panel') return;
      const userId = authSession?.user.id;
      if (!userId || !selectedWordBookId) return;
      if (!dataReady) return;
      if (!generatedVocabularyLoadSucceededForSelectedBook) return;
      if (!expansionSettingLoadSucceededForSelectedBook) return;
      if (!expansionSettingEnabled) return;
      if (!isBaseFullyStudied) return;
      if (expansionInFlightRef.current !== null) return;

      const utcDate = new Date().toISOString().slice(0, 10);
      const attemptKey = `${userId}:${selectedWordBookId}:${utcDate}`;
      if (autoExpansionAttemptedKeysRef.current.has(attemptKey)) return;

      void runExpansionRequest(selectedWordBookId, 'auto');
    }, [
      isAppActive,
      screenMode,
      authSession?.user.id,
      selectedWordBookId,
      dataReady,
      generatedVocabularyLoadSucceededForSelectedBook,
      expansionSettingLoadSucceededForSelectedBook,
      expansionSettingEnabled,
      isBaseFullyStudied,
      isRequestingExpansion,
      runExpansionRequest,
    ]),
  );

  const handleEnableExpansion = async () => {
    if (!selectedWordBookId || isExpansionSettingSaving) return;
    if (!isAppActiveRef.current) return;
    const requestedUserId = currentUserIdRef.current;
    if (!requestedUserId) return;
    const requestedWordBookId = selectedWordBookId;

    // Claims the save slot for this exact call. Only this call may clear
    // isExpansionSettingSaving/the slot below — if a newer call has since
    // claimed it (e.g. after an account switch, or the same user signing
    // out and back in and saving the same book again, let a new save start
    // while this one was still awaiting the network), this call's
    // completion must leave that newer save's loading state alone rather
    // than resetting it early and risking a duplicate submit. operationId
    // (not userId/wordBookId) is what's actually compared, since a
    // same-user re-login can produce two calls with an identical
    // userId/wordBookId pair.
    const operationId = (expansionSettingSaveOperationIdRef.current += 1);
    expansionSettingSaveOwnerRef.current = { userId: requestedUserId, wordBookId: requestedWordBookId, operationId };
    const ownsSaveSlot = () => expansionSettingSaveOwnerRef.current?.operationId === operationId;

    setIsExpansionSettingSaving(true);
    setExpansionToggleError(null);

    try {
      await setVocabularyExpansionEnabled(requestedWordBookId, true);
    } catch {
      if (currentUserIdRef.current === requestedUserId && selectedWordBookIdRef.current === requestedWordBookId) {
        setExpansionToggleError('开启失败，请稍后重试。');
      }
      if (ownsSaveSlot()) {
        expansionSettingSaveOwnerRef.current = null;
        setIsExpansionSettingSaving(false);
      }
      return;
    }

    // The save itself already succeeded in the database regardless of what
    // happens below — only whether *this page* reflects it, and whether it
    // goes on to call the Edge Function, depends on the user still being on
    // this exact account/book/panel.
    const stillRelevant =
      currentUserIdRef.current === requestedUserId &&
      selectedWordBookIdRef.current === requestedWordBookId &&
      screenModeRef.current === 'panel';

    if (stillRelevant) {
      setExpansionSettingEnabled(true);
    }
    if (ownsSaveSlot()) {
      expansionSettingSaveOwnerRef.current = null;
      setIsExpansionSettingSaving(false);
    }

    // If the user has since switched account, word book, or left the panel,
    // never call the Edge Function for the book/account they opened this
    // from — and never let its (nonexistent) result reach the UI. Returning
    // to this word book later re-evaluates via the normal setting fetch
    // (now correctly reading is_enabled=true) and the auto-trigger effect.
    if (stillRelevant) {
      void runExpansionRequest(requestedWordBookId, 'manual');
    }
  };

  const handlePauseExpansion = async () => {
    if (!selectedWordBookId || isExpansionSettingSaving) return;
    if (!isAppActiveRef.current) return;
    const requestedUserId = currentUserIdRef.current;
    if (!requestedUserId) return;
    const requestedWordBookId = selectedWordBookId;

    // A pause always cancels any pending delayed recheck for the book being
    // paused — there is no point rechecking generation status for a book
    // the user just asked to stop expanding.
    cancelExpansionRecheck();

    // Same save-slot ownership as handleEnableExpansion above.
    const operationId = (expansionSettingSaveOperationIdRef.current += 1);
    expansionSettingSaveOwnerRef.current = { userId: requestedUserId, wordBookId: requestedWordBookId, operationId };
    const ownsSaveSlot = () => expansionSettingSaveOwnerRef.current?.operationId === operationId;

    setIsExpansionSettingSaving(true);
    setExpansionToggleError(null);

    try {
      await setVocabularyExpansionEnabled(requestedWordBookId, false);
    } catch {
      if (currentUserIdRef.current === requestedUserId && selectedWordBookIdRef.current === requestedWordBookId) {
        setExpansionToggleError('暂停失败，请稍后重试。');
      }
      if (ownsSaveSlot()) {
        expansionSettingSaveOwnerRef.current = null;
        setIsExpansionSettingSaving(false);
      }
      return;
    }

    if (currentUserIdRef.current === requestedUserId && selectedWordBookIdRef.current === requestedWordBookId) {
      setExpansionSettingEnabled(false);
    }
    if (ownsSaveSlot()) {
      expansionSettingSaveOwnerRef.current = null;
      setIsExpansionSettingSaving(false);
    }
  };

  const handleDismissExpansionCard = () => {
    setDismissedExpansionCard(true);
  };

  // Bypasses autoExpansionAttemptedKeysRef entirely — a manual retry/refresh
  // must always be able to fire regardless of whether today's automatic
  // attempt already happened (runExpansionRequest's own in-flight guard is
  // still the only thing that can block it). Also used as the "刷新状态"
  // action once a generation_in_progress recheck has already happened once —
  // tapping it starts a genuinely new 'manual' attempt, which is itself
  // allowed one more delayed recheck if it, too, comes back in-progress.
  const handleRetryExpansion = () => {
    if (!selectedWordBookId) return;
    if (!isAppActiveRef.current) return;
    void runExpansionRequest(selectedWordBookId, 'manual');
  };

  const isGeneratingSelectedExpansion =
    isRequestingExpansion &&
    expansionInFlightRef.current !== null &&
    expansionInFlightRef.current.userId === authSession?.user.id &&
    expansionInFlightRef.current.wordBookId === selectedWordBookId;

  // The main opt-in/status card shows as soon as there is a *trustworthy
  // cache* for both the generated words and the setting (available, not
  // necessarily the latest attempt having succeeded) — this is what keeps
  // it visible (showing the last-known enabled state) while a background
  // refresh is failing, per generatedVocabularyAvailableForSelectedBook and
  // expansionSettingAvailableForSelectedBook above.
  const showExpansionCard =
    screenMode === 'panel' &&
    isBaseFullyStudied &&
    generatedVocabularyAvailableForSelectedBook &&
    expansionSettingAvailableForSelectedBook &&
    (expansionSettingEnabled || !dismissedExpansionCard);

  // A dedicated, blocking error card for when the *setting itself* has never
  // successfully loaded for this book — shown instead of (never alongside)
  // showExpansionCard, since without knowing the real on/off state there is
  // nothing trustworthy to render as an opt-in/status card.
  const showExpansionSettingErrorCard =
    screenMode === 'panel' &&
    isBaseFullyStudied &&
    !expansionSettingAvailableForSelectedBook &&
    expansionSettingErrorForSelectedBook;

  // Same idea for the generated-word list itself, but only once the setting
  // is known — otherwise the setting error card above already explains why
  // nothing else can render yet.
  const showGeneratedVocabularyErrorCard =
    screenMode === 'panel' &&
    isBaseFullyStudied &&
    expansionSettingAvailableForSelectedBook &&
    !generatedVocabularyAvailableForSelectedBook &&
    generatedVocabularyErrorForSelectedBook;

  const learnSummaryIsPaused =
    learnSession !== null &&
    learnSession.endReason !== 'completed-target' &&
    learnSession.endReason !== 'book-exhausted';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {screenMode === 'panel' && (
        <View style={styles.header}>
          <Text style={styles.brand}>RoleWords</Text>
          <Text style={styles.heroTitle}>今天继续学一点</Text>
        </View>
      )}

      {wordBooksLoadState === 'loading' && (
        <View style={styles.stateCard}>
          <Text style={styles.statusText}>正在加载词书列表…</Text>
        </View>
      )}

      {wordBooksLoadState === 'error' && (
        <View style={styles.stateCard}>
          <Text style={styles.errorText}>词书列表加载失败，请检查网络。</Text>
          <Pressable
            onPress={() => setWordBooksRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载词书列表"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {wordBooksLoadState === 'loaded' && wordBooksState.length === 0 && (
        <View style={styles.stateCard}>
          <Text style={styles.errorText}>词书列表为空，暂时没有可学习的词书。</Text>
          <Pressable
            onPress={() => setWordBooksRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载词书列表"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {wordBooksLoadState === 'loaded' && wordBooksState.length > 0 && loadState === 'loading' && (
        <View style={styles.stateCard}>
          <Text style={styles.statusText}>正在加载学习进度…</Text>
        </View>
      )}

      {wordBooksLoadState === 'loaded' && wordBooksState.length > 0 && loadState === 'error' && (
        <View style={styles.stateCard}>
          <Text style={styles.errorText}>学习进度加载失败，请检查网络。</Text>
          <Pressable
            onPress={() => setRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载学习进度"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {vocabularyPendingForSelectedBook && (
        <View style={styles.stateCard}>
          <Text style={styles.statusText}>正在加载词条…</Text>
        </View>
      )}

      {wordBooksLoadState === 'loaded' &&
        wordBooksState.length > 0 &&
        loadState === 'loaded' &&
        vocabularyErrorForSelectedBook && (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>词条加载失败，请检查网络。</Text>
            <Pressable
              onPress={() => setVocabularyRetryToken((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="重试加载词条"
              style={styles.retryButton}>
              <Text style={styles.retryButtonText}>重试</Text>
            </Pressable>
          </View>
        )}

      {dataReady && screenMode === 'panel' && selectedWordBook && (
        <>
          <View style={styles.segmentedTrack}>
            {wordBooksState.map((book) => {
              const isSelected = book.id === selectedWordBookId;
              return (
                <Pressable
                  key={book.id}
                  onPress={() => handleSelectWordBook(book.id)}
                  disabled={isRestarting}
                  accessibilityRole="button"
                  accessibilityLabel={`切换到${book.chineseTitle}词书`}
                  accessibilityState={{ selected: isSelected, disabled: isRestarting }}
                  style={[
                    styles.segmentButton,
                    isSelected && styles.segmentButtonSelected,
                    isRestarting && styles.disabledOpacity,
                  ]}>
                  <Text
                    style={[styles.segmentButtonText, isSelected && styles.segmentButtonTextSelected]}
                    numberOfLines={1}>
                    {book.chineseTitle}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.wordBookInfoCard}>
            <Text style={styles.wordBookTitle} numberOfLines={1}>
              {selectedWordBook.title} · {selectedWordBook.chineseTitle}
            </Text>
            <View style={styles.wordBookStatsRow}>
              <Text style={styles.wordBookStatsText}>
                已掌握 {baseMasteredCount} / {baseVocabularyItems.length}
              </Text>
              <Text style={styles.wordBookStatsPercent}>{baseMasteredPercent}%</Text>
            </View>
            <ProgressBar ratio={baseVocabularyItems.length > 0 ? baseMasteredCount / baseVocabularyItems.length : 0} />
          </View>

          {showExpansionSettingErrorCard && (
            <View style={styles.expansionCard}>
              <Text style={styles.expansionErrorText}>每日扩展设置加载失败，请检查网络。</Text>
              <Pressable
                onPress={() => setExpansionSettingRetryToken((n) => n + 1)}
                accessibilityRole="button"
                accessibilityLabel="重试加载每日扩展设置"
                style={styles.expansionSecondaryButton}>
                <Text style={styles.expansionSecondaryButtonText}>重试</Text>
              </Pressable>
            </View>
          )}

          {showGeneratedVocabularyErrorCard && (
            <View style={styles.expansionCard}>
              <Text style={styles.expansionErrorText}>扩展词数据加载失败，请检查网络。</Text>
              <Pressable
                onPress={() => setGeneratedVocabularyRetryToken((n) => n + 1)}
                accessibilityRole="button"
                accessibilityLabel="重试加载扩展词数据"
                style={styles.expansionSecondaryButton}>
                <Text style={styles.expansionSecondaryButtonText}>重试</Text>
              </Pressable>
            </View>
          )}

          {showExpansionCard && (
            <View style={styles.expansionCard}>
              {(expansionSettingErrorForSelectedBook || generatedVocabularyErrorForSelectedBook) && (
                <View style={styles.expansionStaleNotice}>
                  <Text style={styles.expansionErrorText}>
                    {expansionSettingErrorForSelectedBook
                      ? '每日扩展设置刷新失败，当前显示的是上次加载的状态。'
                      : '扩展词数据刷新失败，当前显示的是已缓存的扩展词。'}
                  </Text>
                  <Pressable
                    onPress={() => {
                      if (expansionSettingErrorForSelectedBook) {
                        setExpansionSettingRetryToken((n) => n + 1);
                      }
                      if (generatedVocabularyErrorForSelectedBook) {
                        setGeneratedVocabularyRetryToken((n) => n + 1);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="重试刷新每日扩展数据"
                    style={styles.expansionSecondaryButton}>
                    <Text style={styles.expansionSecondaryButtonText}>重试</Text>
                  </Pressable>
                </View>
              )}

              {expansionSettingEnabled ? (
                <>
                  <Text style={styles.expansionCardTitle}>AI 每日扩展已开启</Text>

                  {isGeneratingSelectedExpansion ? (
                    <View style={styles.expansionStatusRow}>
                      <ActivityIndicator size="small" color={COLORS.accent} />
                      <Text style={styles.expansionCardText}>正在准备今天的20个扩展词…</Text>
                    </View>
                  ) : isExpansionInProgress ? (
                    <Text style={styles.expansionCardText}>正在准备今天的20个扩展词…</Text>
                  ) : expansionGenerationError ? (
                    <Text style={styles.expansionErrorText}>{expansionGenerationError}</Text>
                  ) : isExpansionBacklogRemaining ? (
                    <Text style={styles.expansionCardText}>学完当前扩展词后，将继续准备下一批。</Text>
                  ) : null}

                  {expansionToggleError && <Text style={styles.expansionErrorText}>{expansionToggleError}</Text>}

                  <View style={styles.expansionButtonsRow}>
                    {(expansionGenerationError || (isExpansionInProgress && !isGeneratingSelectedExpansion)) && (
                      <Pressable
                        onPress={handleRetryExpansion}
                        disabled={isGeneratingSelectedExpansion}
                        accessibilityRole="button"
                        accessibilityLabel={expansionGenerationError ? '重试准备扩展词' : '刷新扩展词生成状态'}
                        accessibilityState={{ disabled: isGeneratingSelectedExpansion }}
                        style={[styles.expansionSecondaryButton, isGeneratingSelectedExpansion && styles.disabledOpacity]}>
                        <Text style={styles.expansionSecondaryButtonText}>
                          {expansionGenerationError ? '重试' : '刷新状态'}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={handlePauseExpansion}
                      disabled={isExpansionSettingSaving || isGeneratingSelectedExpansion}
                      accessibilityRole="button"
                      accessibilityLabel="暂停每日扩展"
                      accessibilityState={{ disabled: isExpansionSettingSaving || isGeneratingSelectedExpansion }}
                      style={[
                        styles.expansionSecondaryButton,
                        (isExpansionSettingSaving || isGeneratingSelectedExpansion) && styles.disabledOpacity,
                      ]}>
                      <Text style={styles.expansionSecondaryButtonText}>
                        {isExpansionSettingSaving ? '正在暂停…' : '暂停每日扩展'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.expansionCardTitle}>AI 每日扩展</Text>
                  <Text style={styles.expansionCardText}>每天最多准备20个新词，上一批学完后才会继续。</Text>

                  {expansionToggleError && <Text style={styles.expansionErrorText}>{expansionToggleError}</Text>}

                  <View style={styles.expansionButtonsRow}>
                    <Pressable
                      onPress={handleEnableExpansion}
                      disabled={isExpansionSettingSaving}
                      accessibilityRole="button"
                      accessibilityLabel="开启每日扩展"
                      accessibilityState={{ disabled: isExpansionSettingSaving }}
                      style={[styles.expansionPrimaryButton, isExpansionSettingSaving && styles.disabledOpacity]}>
                      {isExpansionSettingSaving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.expansionPrimaryButtonText}>开启每日扩展</Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={handleDismissExpansionCard}
                      disabled={isExpansionSettingSaving}
                      accessibilityRole="button"
                      accessibilityLabel="暂时不显示每日扩展卡片"
                      style={styles.expansionDismissButton}>
                      <Text style={styles.expansionDismissButtonText}>暂时不要</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}

          <View style={styles.sessionCard}>
            <Text style={styles.sessionCardTitle}>本次学习</Text>

            <View style={styles.sessionBlock}>
              <Text style={styles.sessionBlockTitle}>Learn 新词与巩固</Text>

              {baseVocabularyItems.length === 0 ? (
                <Text style={styles.sessionBlockEmpty}>该词书暂无词条数据，请稍后重试。</Text>
              ) : (
                newWordIds.length === 0 &&
                carryoverWordIds.length === 0 && (
                  <Text style={styles.sessionBlockEmpty}>本词书新词已全部学完，去 Review 复习吧。</Text>
                )
              )}

              <Pressable
                onPress={handleStartLearn}
                disabled={newWordIds.length === 0 && carryoverWordIds.length === 0}
                accessibilityRole="button"
                accessibilityLabel="开始学习"
                style={[
                  styles.primaryButton,
                  newWordIds.length === 0 && carryoverWordIds.length === 0 && styles.disabledOpacity,
                ]}>
                <Text style={styles.primaryButtonText}>开始学习</Text>
              </Pressable>
            </View>

            <View style={styles.sessionDivider} />

            <View style={styles.sessionBlock}>
              <Text style={styles.sessionBlockTitle}>Review 复习</Text>

              {dueWordIds.length > 0 ? (
                <View style={styles.statChipsRow}>
                  <View style={styles.statChip}>
                    <Text style={styles.statChipValue}>{dueWordIds.length}</Text>
                    <Text style={styles.statChipLabel}>到期待复习</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.sessionBlockEmpty}>暂无到期复习词，继续学习新词吧。</Text>
              )}

              <Pressable
                onPress={handleStartReview}
                disabled={dueWordIds.length === 0}
                accessibilityRole="button"
                accessibilityLabel="开始复习"
                style={[styles.secondaryButton, dueWordIds.length === 0 && styles.disabledOpacity]}>
                <Text style={styles.secondaryButtonText}>开始复习</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.restartSection}>
            {restartError && <Text style={styles.errorText}>{restartError}</Text>}
            <Pressable
              onPress={handleRequestRestartWordBook}
              disabled={isRestarting}
              accessibilityRole="button"
              accessibilityLabel="重新学习整本词书，清空本词书学习进度"
              style={[styles.dangerLinkButton, isRestarting && styles.disabledOpacity]}>
              <Text style={styles.dangerLinkButtonText}>
                {isRestarting ? '正在重置…' : '重新学习整本词书（清空本词书学习进度）'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {dataReady && selectedWordBook && learnPhase === 'active' && learnSession && currentWord && (
        <>
          <Text style={styles.wordBookKicker} numberOfLines={1}>
            {selectedWordBook.title} · {selectedWordBook.chineseTitle}
          </Text>
          <WordCard
            word={currentWord}
            isGenerated={generatedWordIdSet.has(currentWord.id)}
            progressCurrent={learnSession.completedWordIds.length}
            progressTotal={LEARN_TARGET_COMPLETED}
            progressLabel="完成"
            onExit={handleReturnToPanel}
            exitDisabled={isSaving}
            recognitionCount={progressByItemId[currentWord.id]?.recognitionCount ?? 0}
            isSaved={isCurrentWordSaved}
            isBookmarkBusy={isBookmarkBusy}
            savedLoadState={savedLoadState}
            onRetrySavedLoad={() => setSavedRetryToken((n) => n + 1)}
            onToggleBookmark={handleToggleBookmark}
            bookmarkError={bookmarkError}
            isSaving={isSaving}
            saveError={saveError}
            onChoice={handleLearnChoice}
          />
        </>
      )}

      {dataReady && learnPhase === 'summary' && learnSession && (
        <View style={styles.summaryCard}>
          <View style={[styles.summaryBadge, learnSummaryIsPaused && styles.summaryBadgePaused]}>
            <Text style={[styles.summaryBadgeText, learnSummaryIsPaused && styles.summaryBadgeTextPaused]}>
              {learnSummaryTitle(learnSession.endReason)}
            </Text>
          </View>

          <Text style={styles.summaryHero}>完成一组，休息一下</Text>
          {learnSession.endReason === 'book-exhausted' && (
            <Text style={styles.summaryNote}>本词书新词已全部学完。</Text>
          )}

          <View style={styles.summaryHeroStatRow}>
            <Text style={styles.summaryHeroStatValue}>{learnSession.completedWordIds.length}</Text>
            <Text style={styles.summaryHeroStatDivider}>/</Text>
            <Text style={styles.summaryHeroStatTotal}>{LEARN_TARGET_COMPLETED}</Text>
            <Text style={styles.summaryHeroStatLabel}>已完成目标</Text>
          </View>
          <ProgressBar
            ratio={LEARN_TARGET_COMPLETED > 0 ? learnSession.completedWordIds.length / LEARN_TARGET_COMPLETED : 0}
          />

          <Text style={styles.sectionLabel}>本组完成词</Text>
          {learnSession.completedWordIds.length > 0 ? (
            <View style={styles.completedList}>
              {learnSession.completedWordIds.map((id, index) => {
                const item = vocabularyById.get(id);
                return (
                  <View
                    key={id}
                    style={[styles.completedRow, index > 0 && styles.completedRowDivider]}>
                    <Text style={styles.completedTerm}>{item?.term ?? id}</Text>
                    {item?.chineseMeaning && (
                      <Text style={styles.completedMeaning}>{item.chineseMeaning}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.summaryNote}>暂无</Text>
          )}

          <Pressable
            onPress={handleReturnToPanel}
            accessibilityRole="button"
            accessibilityLabel="完成本组，返回学习首页"
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>返回学习首页</Text>
          </Pressable>

          {(newWordIds.length > 0 || carryoverWordIds.length > 0) && (
            <Pressable
              onPress={handleStartLearn}
              accessibilityRole="button"
              accessibilityLabel="再学一组"
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>再学一组</Text>
            </Pressable>
          )}
        </View>
      )}

      {dataReady && selectedWordBook && reviewPhase === 'active' && reviewSession && currentWord && (
        <>
          <Text style={styles.wordBookKicker} numberOfLines={1}>
            {selectedWordBook.title} · {selectedWordBook.chineseTitle}
          </Text>
          <WordCard
            word={currentWord}
            isGenerated={generatedWordIdSet.has(currentWord.id)}
            progressCurrent={reviewSession.reviewedWordIds.length}
            progressTotal={reviewSession.totalCount}
            progressLabel="复习进度"
            onExit={handleReturnToPanel}
            exitDisabled={isSaving}
            recognitionCount={progressByItemId[currentWord.id]?.recognitionCount ?? 0}
            isSaved={isCurrentWordSaved}
            isBookmarkBusy={isBookmarkBusy}
            savedLoadState={savedLoadState}
            onRetrySavedLoad={() => setSavedRetryToken((n) => n + 1)}
            onToggleBookmark={handleToggleBookmark}
            bookmarkError={bookmarkError}
            isSaving={isSaving}
            saveError={saveError}
            onChoice={handleReviewChoice}
          />
        </>
      )}

      {dataReady && reviewPhase === 'summary' && reviewSession && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>本组复习完成</Text>
          </View>

          <Text style={styles.summaryHero}>复习完成，继续保持</Text>

          <View style={styles.summaryHeroStatRow}>
            <Text style={styles.summaryHeroStatValue}>{reviewSession.reviewedWordIds.length}</Text>
            <Text style={styles.summaryHeroStatDivider}>/</Text>
            <Text style={styles.summaryHeroStatTotal}>{reviewSession.totalCount}</Text>
            <Text style={styles.summaryHeroStatLabel}>已复习</Text>
          </View>
          <ProgressBar
            ratio={reviewSession.totalCount > 0 ? reviewSession.reviewedWordIds.length / reviewSession.totalCount : 0}
          />

          <View style={styles.statGrid}>
            <View style={styles.statGridRow}>
              <View style={styles.statGridItem}>
                <Text style={styles.statGridValue}>{reviewSession.unknownCount}</Text>
                <Text style={styles.statGridLabel}>不认识</Text>
              </View>
              <View style={styles.statGridItem}>
                <Text style={styles.statGridValue}>{reviewSession.fuzzyCount}</Text>
                <Text style={styles.statGridLabel}>模糊</Text>
              </View>
            </View>
            <View style={styles.statGridRow}>
              <View style={styles.statGridItem}>
                <Text style={styles.statGridValue}>{reviewSession.knownCount}</Text>
                <Text style={styles.statGridLabel}>认识</Text>
              </View>
              <View style={styles.statGridItem}>
                <Text style={styles.statGridValue}>{dueWordIds.length}</Text>
                <Text style={styles.statGridLabel}>仍然到期</Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleReturnToPanel}
            accessibilityRole="button"
            accessibilityLabel="完成复习，返回学习首页"
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>返回学习首页</Text>
          </Pressable>

          {dueWordIds.length > 0 && (
            <Pressable
              onPress={handleStartReview}
              accessibilityRole="button"
              accessibilityLabel="再复习一组"
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>再复习一组</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
    gap: 16,
  },
  header: {
    width: '100%',
    gap: 4,
  },
  brand: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: COLORS.accent,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.ink,
  },
  disabledOpacity: {
    opacity: 0.5,
  },
  stateCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    padding: 20,
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.danger,
  },
  retryButton: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  segmentedTrack: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: COLORS.grayTrack,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentButtonSelected: {
    backgroundColor: COLORS.ink,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.inkSoft,
  },
  segmentButtonTextSelected: {
    color: '#fff',
  },
  wordBookInfoCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    padding: 18,
    gap: 8,
  },
  wordBookTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.ink,
  },
  wordBookKicker: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray,
    width: '100%',
  },
  wordBookStatsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  wordBookStatsText: {
    fontSize: 13,
    color: COLORS.inkSoft,
  },
  wordBookStatsPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.grayTrack,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressFillAccent: {
    backgroundColor: COLORS.accent,
  },
  progressFillWarm: {
    backgroundColor: COLORS.warm,
  },
  sessionCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    padding: 18,
    gap: 14,
  },
  sessionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.ink,
  },
  sessionBlock: {
    gap: 8,
  },
  sessionBlockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.ink,
  },
  sessionBlockEmpty: {
    fontSize: 13,
    color: COLORS.gray,
  },
  sessionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  statChipsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statChip: {
    borderRadius: 10,
    backgroundColor: COLORS.accentSoft,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
    gap: 1,
  },
  statChipValue: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.ink,
  },
  statChipLabel: {
    fontSize: 11,
    color: COLORS.inkSoft,
  },
  primaryButton: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    width: '100%',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    width: '100%',
  },
  secondaryButtonText: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  restartSection: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
  },
  dangerLinkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dangerLinkButtonText: {
    fontSize: 12,
    color: COLORS.danger,
  },
  expansionCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    padding: 18,
    gap: 8,
  },
  expansionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.ink,
  },
  expansionCardText: {
    fontSize: 13,
    color: COLORS.inkSoft,
  },
  expansionErrorText: {
    fontSize: 13,
    color: COLORS.danger,
  },
  expansionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expansionStaleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 10,
    backgroundColor: COLORS.grayTrack,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  expansionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  expansionPrimaryButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  expansionPrimaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  expansionSecondaryButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  expansionSecondaryButtonText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  expansionDismissButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  expansionDismissButtonText: {
    color: COLORS.gray,
    fontSize: 13,
    fontWeight: '600',
  },
  generatedBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    backgroundColor: COLORS.grayTrack,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  generatedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gray,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    padding: 20,
    gap: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardProgressGroup: {
    flex: 1,
    gap: 6,
  },
  cardProgressText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
  },
  exitButton: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: COLORS.grayTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  word: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.ink,
  },
  bookmarkButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pronunciationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  ipaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ipa: {
    fontSize: 15,
    color: COLORS.inkSoft,
  },
  accentBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.gray,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  partOfSpeech: {
    fontSize: 13,
    fontStyle: 'italic',
    color: COLORS.gray,
  },
  speakerButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallRetryButton: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallRetryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accent,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  recognitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recognitionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.grayTrack,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  dotFilled: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  fieldBlock: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLORS.gray,
    textTransform: 'uppercase',
  },
  meaning: {
    fontSize: 17,
    lineHeight: 24,
    color: COLORS.ink,
  },
  example: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.inkSoft,
  },
  translation: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.gray,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  choiceButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  choiceButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  choiceButtonNeutral: {
    backgroundColor: COLORS.grayTrack,
    borderColor: COLORS.border,
  },
  choiceButtonTextNeutral: {
    color: COLORS.inkSoft,
  },
  choiceButtonWarm: {
    backgroundColor: COLORS.warmSoft,
    borderColor: COLORS.warm,
  },
  choiceButtonTextWarm: {
    color: COLORS.warmDark,
  },
  choiceButtonPrimary: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  choiceButtonTextPrimary: {
    color: '#fff',
  },
  summaryCard: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    padding: 20,
    gap: 12,
  },
  summaryBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: COLORS.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  summaryBadgePaused: {
    backgroundColor: COLORS.warmSoft,
  },
  summaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.accent,
  },
  summaryBadgeTextPaused: {
    color: COLORS.warmDark,
  },
  summaryHero: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.ink,
  },
  summaryNote: {
    fontSize: 13,
    color: COLORS.gray,
  },
  summaryHeroStatRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
  },
  summaryHeroStatValue: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.ink,
  },
  summaryHeroStatDivider: {
    fontSize: 18,
    color: COLORS.gray,
  },
  summaryHeroStatTotal: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.gray,
  },
  summaryHeroStatLabel: {
    fontSize: 13,
    color: COLORS.gray,
    marginLeft: 4,
  },
  statGrid: {
    gap: 8,
  },
  statGridRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statGridItem: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: COLORS.grayTrack,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 1,
  },
  statGridValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.ink,
  },
  statGridLabel: {
    fontSize: 11,
    color: COLORS.gray,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray,
    marginTop: 4,
  },
  completedList: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: COLORS.grayTrack,
    overflow: 'hidden',
  },
  completedRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  completedRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  completedTerm: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.ink,
  },
  completedMeaning: {
    fontSize: 13,
    color: COLORS.gray,
  },
});
