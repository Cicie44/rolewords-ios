import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { sampleVocabulary } from '@/src/data/sampleVocabulary';
import { wordBooks } from '@/src/data/wordBooks';
import { playPronunciation } from '@/src/services/pronunciationService';
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

export default function LearnScreen() {
  const [selectedWordBookId, setSelectedWordBookId] = useState(wordBooks[0].id);
  const [sessionsByBookId, setSessionsByBookId] = useState<Record<string, WordBookSession>>({});
  const [progressByItemId, setProgressByItemId] = useState<Record<string, UserWordProgress>>({});
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

  // Auto-plays each new card's pronunciation exactly once. The ref guard
  // (rather than relying on the dependency array alone) protects against
  // React re-running this effect for the same card, e.g. under Strict Mode's
  // double-invocation in development.
  useEffect(() => {
    if (!currentWord) {
      return;
    }

    const presentationKey = `${selectedWordBookId}:${session.reviewSequence}:${currentWord.id}`;
    if (lastAutoPlayedPresentationKeyRef.current === presentationKey) {
      return;
    }
    lastAutoPlayedPresentationKeyRef.current = presentationKey;

    void playPronunciation(currentWord.pronunciationText ?? currentWord.term);
  }, [selectedWordBookId, session.reviewSequence, currentWord]);

  const handleChoice = (familiarity: Familiarity) => {
    if (!currentWord) {
      return;
    }

    const presentationKey = `${selectedWordBookId}:${session.reviewSequence}:${currentWord.id}`;
    if (handledPresentationKeyRef.current === presentationKey) {
      return;
    }
    handledPresentationKeyRef.current = presentationKey;

    const now = new Date().toISOString();
    const previousRecognitionCount = progressByItemId[currentWord.id]?.recognitionCount ?? 0;
    const recognitionCount = nextRecognitionCount(familiarity, previousRecognitionCount);
    const status: LearningStatus = recognitionCount >= MAX_RECOGNITION_COUNT ? 'mastered' : 'learning';

    setProgressByItemId((prev) => {
      const previousReviewCount = prev[currentWord.id]?.reviewCount ?? 0;

      return {
        ...prev,
        [currentWord.id]: {
          vocabularyItemId: currentWord.id,
          status,
          familiarity,
          recognitionCount,
          reviewCount: previousReviewCount + 1,
          lastReviewedAt: now,
        },
      };
    });

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
  };

  const handleRestart = () => {
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
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>学习 Learn</Text>

      <View style={styles.tabRow}>
        {wordBooks.map((book) => {
          const isSelected = book.id === selectedWordBookId;
          return (
            <Pressable
              key={book.id}
              onPress={() => setSelectedWordBookId(book.id)}
              style={[styles.tabButton, isSelected && styles.tabButtonSelected]}>
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

          <Pressable
            onPress={handleRestart}
            accessibilityRole="button"
            accessibilityLabel="重新学习本词书"
            style={styles.restartButton}>
            <Text style={styles.restartButtonText}>重新学习</Text>
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
            </View>

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

            <View style={styles.choiceRow}>
              {CHOICES.map(({ familiarity, label }) => (
                <Pressable
                  key={familiarity}
                  onPress={() => handleChoice(familiarity)}
                  accessibilityRole="button"
                  accessibilityLabel={`标记 ${currentWord.term} 为${label}`}
                  style={styles.choiceButton}>
                  <Text style={styles.choiceButtonText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )
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
