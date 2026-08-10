import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { fetchVocabularyByWordBookId, fetchWordBooks } from '@/src/services/vocabularyService';
import type { SavedItem, SavedItemType } from '@/src/types/savedItem';
import type { Familiarity, UserWordProgress, VocabularyItem, WordBook } from '@/src/types/vocabulary';
import type { LearnSession, ReviewSession, ScreenMode } from '@/src/types/learningSession';

const CHOICES: { familiarity: Familiarity; label: string }[] = [
  { familiarity: 'unknown', label: '不认识' },
  { familiarity: 'fuzzy', label: '模糊' },
  { familiarity: 'known', label: '认识' },
];

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

// ---------------------------------------------------------------------------
// Shared word card: used by both the Learn-active and Review-active screens
// so pronunciation, bookmarking, and the choice buttons only exist once.
// ---------------------------------------------------------------------------

type WordCardProps = {
  word: VocabularyItem;
  headerLabel: string;
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
  headerLabel,
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
  return (
    <View style={styles.card}>
      <Text style={styles.sessionHeaderText}>{headerLabel}</Text>

      <Text style={styles.word}>{word.term}</Text>

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
            tintColor="#2f95dc"
            size={20}
          />
        </Pressable>

        <Pressable
          onPress={onToggleBookmark}
          disabled={isBookmarkBusy || savedLoadState !== 'loaded'}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? `取消收藏 ${word.term}` : `收藏 ${word.term}`}
          hitSlop={8}
          style={styles.bookmarkButton}>
          <SymbolView
            name={{
              ios: isSaved ? 'bookmark.fill' : 'bookmark',
              android: isSaved ? 'bookmark' : 'bookmark_border',
              web: isSaved ? 'bookmark' : 'bookmark_border',
            }}
            tintColor="#2f95dc"
            size={20}
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

      <Text style={styles.recognitionProgress}>
        认识进度 {recognitionCount} / {MAX_RECOGNITION_COUNT}
      </Text>

      <Text style={styles.meaning}>中文：{word.chineseMeaning}</Text>

      {word.englishDefinition && (
        <>
          <Text style={styles.sectionLabel}>Definition</Text>
          <Text style={styles.example}>{word.englishDefinition}</Text>
        </>
      )}

      {word.exampleSentence && (
        <>
          <Text style={styles.sectionLabel}>Example</Text>
          <Text style={styles.example}>{word.exampleSentence}</Text>
        </>
      )}

      {word.exampleTranslation && (
        <>
          <Text style={styles.sectionLabel}>翻译</Text>
          <Text style={styles.translation}>{word.exampleTranslation}</Text>
        </>
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
            style={[styles.choiceButton, isSaving && styles.disabledOpacity]}>
            <Text style={styles.choiceButtonText}>{label}</Text>
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

  const [wordsInBook, setWordsInBook] = useState<VocabularyItem[]>([]);
  const [vocabularyLoadState, setVocabularyLoadState] = useState<LoadState>('loading');
  const [vocabularyRetryToken, setVocabularyRetryToken] = useState(0);
  // Which word book id wordsInBook / vocabularyLoadState's current
  // outcome actually belongs to. Effects fire asynchronously after a state
  // change commits, so there is a real render frame where
  // selectedWordBookId has already changed but the vocabulary-fetch effect
  // hasn't run yet — without these, that frame would render the *previous*
  // book's title/counts/buttons alongside wordsInBook still holding the
  // previous book's items. Every place that reads wordsInBook for
  // rendering must go through vocabularyLoadedForSelectedBook (folded into
  // dataReady) instead of trusting vocabularyLoadState alone.
  const [loadedVocabularyWordBookId, setLoadedVocabularyWordBookId] = useState<string | null>(null);
  const [vocabularyErrorWordBookId, setVocabularyErrorWordBookId] = useState<string | null>(null);
  // Guards against a slow, now-superseded fetch for a previously selected
  // word book overwriting the vocabulary of the word book the user has
  // since switched to.
  const vocabularyRequestTokenRef = useRef(0);

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

  // Only ever covers the currently selected book's vocabulary — Learn and
  // Review sessions never reference a word from any other book, so this
  // never needs to be a global, all-books lookup.
  const vocabularyById = useMemo(() => new Map(wordsInBook.map((item) => [item.id, item])), [wordsInBook]);

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

  // Every dataset needed to actually study must be in before the panel or
  // an active session can render — a book list without its vocabulary (or
  // vice versa) would show wrong or empty counts instead of a real error.
  const dataReady =
    wordBooksLoadState === 'loaded' &&
    wordBooksState.length > 0 &&
    loadState === 'loaded' &&
    vocabularyLoadedForSelectedBook &&
    selectedWordBook !== undefined;

  const masteredCount = wordsInBook.filter(
    (item) => progressByItemId[item.id]?.status === 'mastered',
  ).length;

  // New-word definition: no progress row at all (our own writes never save
  // status 'new', so this is effectively "never studied").
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
      setWordsInBook([]);
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
        setWordsInBook(items);
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>学习 Learn</Text>

      {wordBooksLoadState === 'loading' && (
        <View style={styles.card}>
          <Text style={styles.statusText}>正在加载词书列表…</Text>
        </View>
      )}

      {wordBooksLoadState === 'error' && (
        <View style={styles.card}>
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
        <View style={styles.card}>
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
        <View style={styles.card}>
          <Text style={styles.statusText}>正在加载学习进度…</Text>
        </View>
      )}

      {wordBooksLoadState === 'loaded' && wordBooksState.length > 0 && loadState === 'error' && (
        <View style={styles.card}>
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
        <View style={styles.card}>
          <Text style={styles.statusText}>正在加载词条…</Text>
        </View>
      )}

      {wordBooksLoadState === 'loaded' &&
        wordBooksState.length > 0 &&
        loadState === 'loaded' &&
        vocabularyErrorForSelectedBook && (
          <View style={styles.card}>
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
          <View style={styles.tabRow}>
            {wordBooksState.map((book) => {
              const isSelected = book.id === selectedWordBookId;
              return (
                <Pressable
                  key={book.id}
                  onPress={() => handleSelectWordBook(book.id)}
                  disabled={isRestarting}
                  style={[
                    styles.tabButton,
                    isSelected && styles.tabButtonSelected,
                    isRestarting && styles.disabledOpacity,
                  ]}>
                  <Text style={[styles.tabButtonText, isSelected && styles.tabButtonTextSelected]}>
                    {book.chineseTitle}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.wordBookInfo}>
            <Text style={styles.wordBookTitle}>
              {selectedWordBook.title} · {selectedWordBook.chineseTitle}
            </Text>
            <Text style={styles.wordBookCount}>
              已掌握 {masteredCount} / {wordsInBook.length}
            </Text>
          </View>

          <View style={styles.panelCard}>
            <Text style={styles.panelCardTitle}>Learn 新词与巩固</Text>
            <Text style={styles.panelCardLine}>待学新词：{newWordIds.length} 个</Text>
            <Text style={styles.panelCardLine}>待继续巩固：{carryoverWordIds.length} 个</Text>
            {wordsInBook.length === 0 ? (
              <Text style={styles.panelCardEmpty}>该词书暂无词条数据，请稍后重试。</Text>
            ) : (
              newWordIds.length === 0 &&
              carryoverWordIds.length === 0 && (
                <Text style={styles.panelCardEmpty}>本词书新词已全部学完，去 Review 复习吧。</Text>
              )
            )}
            <Text style={styles.panelCardLine}>默认目标：掌握 {LEARN_TARGET_COMPLETED} 个词</Text>
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

          <View style={styles.panelCard}>
            <Text style={styles.panelCardTitle}>Review 复习</Text>
            {dueWordIds.length > 0 ? (
              <Text style={styles.panelCardLine}>
                当前到期：{dueWordIds.length} 个（每组最多 {REVIEW_GROUP_SIZE} 个）
              </Text>
            ) : (
              <Text style={styles.panelCardEmpty}>暂无到期复习词，继续学习新词吧。</Text>
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
          <Text style={styles.wordBookTitle}>
            {selectedWordBook.title} · {selectedWordBook.chineseTitle}
          </Text>
          <WordCard
            word={currentWord}
            headerLabel={`完成 ${learnSession.completedWordIds.length} / ${LEARN_TARGET_COMPLETED} · 本组已见 ${learnSession.seenWordIds.length} 个词`}
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
          <Pressable
            onPress={handleReturnToPanel}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="退出本组，返回学习控制面板"
            style={[styles.exitLinkButton, isSaving && styles.disabledOpacity]}>
            <Text style={styles.exitLinkButtonText}>退出本组，返回控制面板</Text>
          </Pressable>
        </>
      )}

      {dataReady && learnPhase === 'summary' && learnSession && (
        <View style={styles.card}>
          <Text style={styles.summaryTitle}>{learnSummaryTitle(learnSession.endReason)}</Text>
          {learnSession.endReason === 'book-exhausted' && (
            <Text style={styles.summaryLine}>本词书新词已全部学完。</Text>
          )}
          <Text style={styles.summaryLine}>
            完成目标：{learnSession.completedWordIds.length} / {LEARN_TARGET_COMPLETED}
          </Text>
          <Text style={styles.summaryLine}>本组见过的词数量：{learnSession.seenWordIds.length}</Text>
          <Text style={styles.summaryLine}>卡片总展示次数：{learnSession.totalPresentationCount}</Text>
          <Text style={styles.summaryLine}>不认识选择次数：{learnSession.unknownCount}</Text>
          <Text style={styles.summaryLine}>模糊选择次数：{learnSession.fuzzyCount}</Text>
          <Text style={styles.summaryLine}>认识选择次数：{learnSession.knownCount}</Text>

          <Text style={styles.sectionLabel}>本组完成词</Text>
          <Text style={styles.example}>
            {learnSession.completedWordIds.length > 0
              ? learnSession.completedWordIds
                  .map((id) => vocabularyById.get(id)?.term ?? id)
                  .join('、')
              : '暂无'}
          </Text>

          <Text style={styles.sectionLabel}>下组继续巩固</Text>
          <Text style={styles.example}>
            {learnSession.carryoverWordIds.length > 0
              ? learnSession.carryoverWordIds
                  .map((id) => vocabularyById.get(id)?.term ?? id)
                  .join('、')
              : '暂无'}
          </Text>

          <Text style={styles.sectionLabel}>转入 Review 的困难词</Text>
          <Text style={styles.example}>
            {learnSession.graduatedWordIds.length > 0
              ? learnSession.graduatedWordIds
                  .map((id) => vocabularyById.get(id)?.term ?? id)
                  .join('、')
              : '暂无'}
          </Text>

          <Text style={styles.summaryLine}>当前词书剩余新词数量：{newWordIds.length}</Text>
          <Text style={styles.summaryLine}>当前待继续巩固数量：{carryoverWordIds.length}</Text>

          <Text style={styles.hintText}>已经完成一组学习，休息一下再继续吧。</Text>

          <Pressable
            onPress={handleReturnToPanel}
            accessibilityRole="button"
            accessibilityLabel="完成本组，返回学习控制面板"
            style={styles.restartButton}>
            <Text style={styles.restartButtonText}>完成本组，返回控制面板</Text>
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
          <Text style={styles.wordBookTitle}>
            {selectedWordBook.title} · {selectedWordBook.chineseTitle}
          </Text>
          <WordCard
            word={currentWord}
            headerLabel={`复习进度 ${reviewSession.reviewedWordIds.length} / ${reviewSession.totalCount}`}
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
          <Pressable
            onPress={handleReturnToPanel}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="退出本组，返回学习控制面板"
            style={[styles.exitLinkButton, isSaving && styles.disabledOpacity]}>
            <Text style={styles.exitLinkButtonText}>退出本组，返回控制面板</Text>
          </Pressable>
        </>
      )}

      {dataReady && reviewPhase === 'summary' && reviewSession && (
        <View style={styles.card}>
          <Text style={styles.summaryTitle}>本组复习完成</Text>
          <Text style={styles.summaryLine}>已复习数量：{reviewSession.reviewedWordIds.length}</Text>
          <Text style={styles.summaryLine}>不认识：{reviewSession.unknownCount}</Text>
          <Text style={styles.summaryLine}>模糊：{reviewSession.fuzzyCount}</Text>
          <Text style={styles.summaryLine}>认识：{reviewSession.knownCount}</Text>
          <Text style={styles.summaryLine}>仍然到期的剩余数量：{dueWordIds.length}</Text>

          <Pressable
            onPress={handleReturnToPanel}
            accessibilityRole="button"
            accessibilityLabel="完成复习，返回学习控制面板"
            style={styles.restartButton}>
            <Text style={styles.restartButtonText}>完成复习</Text>
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
    alignItems: 'center',
    padding: 20,
    paddingTop: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  tabButtonSelected: {
    backgroundColor: '#2f95dc',
    borderColor: '#2f95dc',
  },
  tabButtonText: {
    fontSize: 14,
    color: '#333',
  },
  tabButtonTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  disabledOpacity: {
    opacity: 0.5,
  },
  wordBookInfo: {
    width: '100%',
    marginBottom: 16,
  },
  wordBookTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    width: '100%',
  },
  wordBookCount: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  panelCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    padding: 20,
    gap: 6,
    marginBottom: 16,
  },
  panelCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 2,
  },
  panelCardLine: {
    fontSize: 14,
    color: '#333',
  },
  panelCardEmpty: {
    fontSize: 14,
    color: '#888',
  },
  restartSection: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  dangerLinkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dangerLinkButtonText: {
    fontSize: 13,
    color: '#d9534f',
    textDecorationLine: 'underline',
  },
  exitLinkButton: {
    marginTop: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitLinkButtonText: {
    fontSize: 14,
    color: '#888',
    textDecorationLine: 'underline',
  },
  card: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    padding: 20,
    gap: 8,
  },
  sessionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  word: {
    fontSize: 24,
    fontWeight: '700',
  },
  pronunciationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ipaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ipa: {
    fontSize: 15,
    color: '#666',
  },
  accentBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  partOfSpeech: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#888',
  },
  speakerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallRetryButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallRetryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2f95dc',
  },
  recognitionProgress: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2f95dc',
  },
  meaning: {
    fontSize: 16,
    color: '#333',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    marginTop: 8,
  },
  example: {
    fontSize: 15,
    lineHeight: 22,
  },
  translation: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
  statusText: {
    fontSize: 13,
    color: '#888',
  },
  errorText: {
    fontSize: 13,
    color: '#d9534f',
  },
  hintText: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  retryButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  choiceButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  choiceButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  summaryLine: {
    fontSize: 15,
    color: '#333',
  },
  primaryButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#2f95dc',
    fontSize: 16,
    fontWeight: '600',
  },
  restartButton: {
    marginTop: 16,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  restartButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
