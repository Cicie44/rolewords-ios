import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { sampleVocabulary } from '@/src/data/sampleVocabulary';
import { wordBooks } from '@/src/data/wordBooks';
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
  type ProgressByItemId,
} from '@/src/services/wordProgressService';
import type { SavedItem, SavedItemType } from '@/src/types/savedItem';
import type { Familiarity, LearningStatus, UserWordProgress } from '@/src/types/vocabulary';

const MAX_RECOGNITION_COUNT = 3;

const vocabularyById = new Map(sampleVocabulary.map((item) => [item.id, item]));

type WordBookSession = {
  queue: string[];
  reviewSequence: number;
  unknownCount: number;
  fuzzyCount: number;
  knownCount: number;
};

function createInitialSession(wordIds: string[]): WordBookSession {
  return {
    queue: [...wordIds],
    reviewSequence: 0,
    unknownCount: 0,
    fuzzyCount: 0,
    knownCount: 0,
  };
}

// Rebuilds a fresh session for every word book from remote progress: mastered
// words are left out of the queue, everything else keeps sampleVocabulary's
// original order. Per-round counters always restart at zero.
function buildInitialSessionsFromProgress(
  progressByItemId: ProgressByItemId,
): Record<string, WordBookSession> {
  const sessions: Record<string, WordBookSession> = {};

  for (const book of wordBooks) {
    const idsInBook = sampleVocabulary
      .filter((item) => item.wordBookId === book.id)
      .map((item) => item.id);
    const queue = idsInBook.filter((id) => progressByItemId[id]?.status !== 'mastered');
    sessions[book.id] = createInitialSession(queue);
  }

  return sessions;
}

// Inserts wordId into queue after `numberOfOtherWords` other words, clamped
// to the end of the queue if there aren't that many words left.
function insertAfter(queue: string[], wordId: string, numberOfOtherWords: number): string[] {
  const insertIndex = Math.min(numberOfOtherWords, queue.length);
  return [...queue.slice(0, insertIndex), wordId, ...queue.slice(insertIndex)];
}

function nextRecognitionCount(familiarity: Familiarity, previousRecognitionCount: number): number {
  if (familiarity === 'known') {
    return Math.min(previousRecognitionCount + 1, MAX_RECOGNITION_COUNT);
  }
  if (familiarity === 'unknown') {
    return 0;
  }
  return previousRecognitionCount;
}

const CHOICES: { familiarity: Familiarity; label: string }[] = [
  { familiarity: 'unknown', label: '不认识' },
  { familiarity: 'fuzzy', label: '模糊' },
  { familiarity: 'known', label: '认识' },
];

type LoadState = 'loading' | 'loaded' | 'error';

export default function LearnScreen() {
  const { session: authSession } = useAuth();

  const [selectedWordBookId, setSelectedWordBookId] = useState(wordBooks[0].id);
  const [sessionsByBookId, setSessionsByBookId] = useState<Record<string, WordBookSession>>({});
  const [progressByItemId, setProgressByItemId] = useState<Record<string, UserWordProgress>>({});
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [retryToken, setRetryToken] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [savedLoadState, setSavedLoadState] = useState<LoadState>('loading');
  const [savedRetryToken, setSavedRetryToken] = useState(0);
  const [isBookmarkBusy, setIsBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const handledPresentationKeyRef = useRef<string | null>(null);
  const lastAutoPlayedPresentationKeyRef = useRef<string | null>(null);

  const selectedWordBook = wordBooks.find((book) => book.id === selectedWordBookId)!;

  const wordsInBook = useMemo(
    () => sampleVocabulary.filter((item) => item.wordBookId === selectedWordBookId),
    [selectedWordBookId],
  );

  const session =
    sessionsByBookId[selectedWordBookId] ?? createInitialSession(wordsInBook.map((item) => item.id));
  const isRoundComplete = session.queue.length === 0;
  const currentWord = isRoundComplete ? undefined : vocabularyById.get(session.queue[0]);

  const masteredCount = wordsInBook.filter(
    (item) => progressByItemId[item.id]?.status === 'mastered',
  ).length;

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
  // the Saved tab). `savedRetryToken` is a dependency purely so the retry
  // button can force a reload: useFocusEffect's internal effect depends on
  // this callback's identity, so bumping the token makes it clean up the
  // in-flight request (via the returned cleanup) and immediately restart —
  // calling loadSavedItems() directly would not do this, since its cleanup
  // is only ever wired up through useFocusEffect itself.
  const loadSavedItems = useCallback(() => {
    let isActive = true;
    setSavedLoadState('loading');

    fetchSavedItems()
      .then((items) => {
        if (!isActive) {
          return;
        }
        setSavedItems(items);
        setSavedLoadState('loaded');
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setSavedLoadState('error');
      });

    return () => {
      isActive = false;
    };
  }, [savedRetryToken]);

  useFocusEffect(loadSavedItems);

  // Tracks which word is currently shown so async bookmark requests can tell
  // whether the user has already moved on by the time they settle, and
  // clears any bookmark error left over from the previous card.
  const currentWordIdRef = useRef<string | undefined>(currentWord?.id);
  useEffect(() => {
    currentWordIdRef.current = currentWord?.id;
    setBookmarkError(null);
  }, [currentWord?.id]);

  // Loads remote progress once a session is available, rebuilding sessions
  // for all three word books from it. Cancels stale results so an outdated
  // request (component unmounted, or a different user signed in) can never
  // clobber newer state.
  useEffect(() => {
    const userId = authSession?.user.id;
    if (!userId) {
      return;
    }

    let isCancelled = false;
    setLoadState('loading');

    fetchWordProgress()
      .then((remoteProgress) => {
        if (isCancelled) {
          return;
        }
        setProgressByItemId(remoteProgress);
        setSessionsByBookId(buildInitialSessionsFromProgress(remoteProgress));
        handledPresentationKeyRef.current = null;
        lastAutoPlayedPresentationKeyRef.current = null;
        setLoadState('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }
        setLoadState('error');
      });

    return () => {
      isCancelled = true;
    };
  }, [authSession?.user.id, retryToken]);

  // Auto-plays each new card's pronunciation exactly once. The ref guard
  // (rather than relying on the dependency array alone) protects against
  // React re-running this effect for the same card, e.g. under Strict Mode's
  // double-invocation in development.
  useEffect(() => {
    if (loadState !== 'loaded' || !currentWord) {
      return;
    }

    const presentationKey = `${selectedWordBookId}:${session.reviewSequence}:${currentWord.id}`;
    if (lastAutoPlayedPresentationKeyRef.current === presentationKey) {
      return;
    }
    lastAutoPlayedPresentationKeyRef.current = presentationKey;

    void playPronunciation(currentWord.pronunciationText ?? currentWord.term);
  }, [loadState, selectedWordBookId, session.reviewSequence, currentWord]);

  const handleSelectWordBook = (bookId: string) => {
    if (isSaving || isRestarting) {
      return;
    }
    setSelectedWordBookId(bookId);
    setSaveError(null);
    setRestartError(null);
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

  const handleChoice = async (familiarity: Familiarity) => {
    if (!currentWord || isSaving) {
      return;
    }

    const presentationKey = `${selectedWordBookId}:${session.reviewSequence}:${currentWord.id}`;
    if (handledPresentationKeyRef.current === presentationKey) {
      return;
    }
    handledPresentationKeyRef.current = presentationKey;

    const now = new Date().toISOString();
    const previous = progressByItemId[currentWord.id];
    const recognitionCount = nextRecognitionCount(familiarity, previous?.recognitionCount ?? 0);
    const status: LearningStatus = recognitionCount >= MAX_RECOGNITION_COUNT ? 'mastered' : 'learning';

    const nextProgress: UserWordProgress = {
      vocabularyItemId: currentWord.id,
      status,
      familiarity,
      recognitionCount,
      reviewCount: (previous?.reviewCount ?? 0) + 1,
      lastReviewedAt: now,
      nextReviewAt: previous?.nextReviewAt,
    };

    setIsSaving(true);
    setSaveError(null);

    try {
      await saveWordProgress(nextProgress);
    } catch {
      // Reset the guard so the same card can be retried.
      handledPresentationKeyRef.current = null;
      setSaveError('进度保存失败，请检查网络后重试。');
      setIsSaving(false);
      return;
    }

    setProgressByItemId((prev) => ({
      ...prev,
      [currentWord.id]: nextProgress,
    }));

    setSessionsByBookId((prev) => {
      const current =
        prev[selectedWordBookId] ?? createInitialSession(wordsInBook.map((item) => item.id));

      // Boundary guard: only mutate the queue if this word is still at the
      // head — otherwise the session already moved on and this is stale.
      if (current.queue[0] !== currentWord.id) {
        return prev;
      }

      const remainingQueue = current.queue.slice(1);
      let nextQueue: string[];

      if (familiarity === 'unknown') {
        nextQueue = insertAfter(remainingQueue, currentWord.id, 1);
      } else if (familiarity === 'fuzzy') {
        nextQueue = insertAfter(remainingQueue, currentWord.id, 3);
      } else if (status === 'mastered') {
        nextQueue = remainingQueue;
      } else {
        nextQueue = [...remainingQueue, currentWord.id];
      }

      return {
        ...prev,
        [selectedWordBookId]: {
          ...current,
          queue: nextQueue,
          reviewSequence: current.reviewSequence + 1,
          unknownCount: current.unknownCount + (familiarity === 'unknown' ? 1 : 0),
          fuzzyCount: current.fuzzyCount + (familiarity === 'fuzzy' ? 1 : 0),
          knownCount: current.knownCount + (familiarity === 'known' ? 1 : 0),
        },
      };
    });

    setIsSaving(false);
  };

  const handleRestart = async () => {
    if (isRestarting || isSaving) {
      return;
    }

    setIsRestarting(true);
    setRestartError(null);

    try {
      await deleteWordProgress(wordsInBook.map((item) => item.id));
    } catch {
      setRestartError('重置失败，请检查网络后重试。');
      setIsRestarting(false);
      return;
    }

    handledPresentationKeyRef.current = null;
    lastAutoPlayedPresentationKeyRef.current = null;

    setSessionsByBookId((prev) => ({
      ...prev,
      [selectedWordBookId]: createInitialSession(wordsInBook.map((item) => item.id)),
    }));

    setProgressByItemId((prev) => {
      const next = { ...prev };
      for (const item of wordsInBook) {
        delete next[item.id];
      }
      return next;
    });

    setIsRestarting(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>学习 Learn</Text>

      {loadState === 'loading' && (
        <View style={styles.card}>
          <Text style={styles.statusText}>正在加载学习进度…</Text>
        </View>
      )}

      {loadState === 'error' && (
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

      {loadState === 'loaded' && (
        <>
          <View style={styles.tabRow}>
            {wordBooks.map((book) => {
              const isSelected = book.id === selectedWordBookId;
              return (
                <Pressable
                  key={book.id}
                  onPress={() => handleSelectWordBook(book.id)}
                  disabled={isSaving || isRestarting}
                  style={[
                    styles.tabButton,
                    isSelected && styles.tabButtonSelected,
                    (isSaving || isRestarting) && styles.disabledOpacity,
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
            {!isRoundComplete && (
              <>
                <Text style={styles.wordBookCount}>
                  已掌握 {masteredCount} / {wordsInBook.length}
                </Text>
                <Text style={styles.wordBookCount}>待复习 {session.queue.length}</Text>
              </>
            )}
          </View>

          {isRoundComplete ? (
            <View style={styles.card}>
              <Text style={styles.summaryTitle}>本轮完成</Text>
              <Text style={styles.summaryLine}>
                已掌握：{masteredCount} / {wordsInBook.length}
              </Text>
              <Text style={styles.summaryLine}>不认识选择次数：{session.unknownCount}</Text>
              <Text style={styles.summaryLine}>模糊选择次数：{session.fuzzyCount}</Text>
              <Text style={styles.summaryLine}>认识选择次数：{session.knownCount}</Text>
              <Text style={styles.summaryLine}>总复习次数：{session.reviewSequence}</Text>

              {restartError && <Text style={styles.errorText}>{restartError}</Text>}

              <Pressable
                onPress={handleRestart}
                disabled={isRestarting || isSaving}
                accessibilityRole="button"
                accessibilityLabel="重新学习本词书"
                style={[styles.restartButton, isRestarting && styles.disabledOpacity]}>
                <Text style={styles.restartButtonText}>
                  {isRestarting ? '正在重置…' : '重新学习'}
                </Text>
              </Pressable>
            </View>
          ) : (
            currentWord && (
              <View style={styles.card}>
                <Text style={styles.word}>{currentWord.term}</Text>

                <View style={styles.pronunciationRow}>
                  {currentWord.ipa && (
                    <View style={styles.ipaGroup}>
                      <Text style={styles.ipa}>/{currentWord.ipa}/</Text>
                      <Text style={styles.accentBadge}>US</Text>
                    </View>
                  )}
                  {currentWord.partOfSpeech && (
                    <Text style={styles.partOfSpeech}>{currentWord.partOfSpeech}</Text>
                  )}
                  <Pressable
                    onPress={() =>
                      playPronunciation(currentWord.pronunciationText ?? currentWord.term)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`播放 ${currentWord.term} 的发音`}
                    hitSlop={8}
                    style={styles.speakerButton}>
                    <SymbolView
                      name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
                      tintColor="#2f95dc"
                      size={20}
                    />
                  </Pressable>

                  <Pressable
                    onPress={handleToggleBookmark}
                    disabled={isBookmarkBusy || savedLoadState !== 'loaded'}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isCurrentWordSaved ? `取消收藏 ${currentWord.term}` : `收藏 ${currentWord.term}`
                    }
                    hitSlop={8}
                    style={styles.bookmarkButton}>
                    <SymbolView
                      name={{
                        ios: isCurrentWordSaved ? 'bookmark.fill' : 'bookmark',
                        android: isCurrentWordSaved ? 'bookmark' : 'bookmark_border',
                        web: isCurrentWordSaved ? 'bookmark' : 'bookmark_border',
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
                      onPress={() => setSavedRetryToken((n) => n + 1)}
                      accessibilityRole="button"
                      accessibilityLabel="重试加载收藏状态"
                      style={styles.smallRetryButton}>
                      <Text style={styles.smallRetryButtonText}>重试</Text>
                    </Pressable>
                  </View>
                )}
                {bookmarkError && <Text style={styles.errorText}>{bookmarkError}</Text>}

                <Text style={styles.recognitionProgress}>
                  认识进度 {progressByItemId[currentWord.id]?.recognitionCount ?? 0} /{' '}
                  {MAX_RECOGNITION_COUNT}
                </Text>

                <Text style={styles.meaning}>中文：{currentWord.chineseMeaning}</Text>

                {currentWord.englishDefinition && (
                  <>
                    <Text style={styles.sectionLabel}>Definition</Text>
                    <Text style={styles.example}>{currentWord.englishDefinition}</Text>
                  </>
                )}

                {currentWord.exampleSentence && (
                  <>
                    <Text style={styles.sectionLabel}>Example</Text>
                    <Text style={styles.example}>{currentWord.exampleSentence}</Text>
                  </>
                )}

                {currentWord.exampleTranslation && (
                  <>
                    <Text style={styles.sectionLabel}>翻译</Text>
                    <Text style={styles.translation}>{currentWord.exampleTranslation}</Text>
                  </>
                )}

                {saveError && <Text style={styles.errorText}>{saveError}</Text>}
                {isSaving && <Text style={styles.statusText}>正在保存…</Text>}

                <View style={styles.choiceRow}>
                  {CHOICES.map(({ familiarity, label }) => (
                    <Pressable
                      key={familiarity}
                      onPress={() => handleChoice(familiarity)}
                      disabled={isSaving}
                      accessibilityRole="button"
                      accessibilityLabel={`标记 ${currentWord.term} 为${label}`}
                      style={[styles.choiceButton, isSaving && styles.disabledOpacity]}>
                      <Text style={styles.choiceButtonText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )
          )}
        </>
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
  },
  wordBookCount: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    padding: 20,
    gap: 8,
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
