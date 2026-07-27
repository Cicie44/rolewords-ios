import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { sampleVocabulary } from '@/src/data/sampleVocabulary';
import { playPronunciation } from '@/src/services/pronunciationService';
import { fetchSavedItem } from '@/src/services/savedItemsService';
import type { SavedItem, SavedItemSourceType, SavedItemType } from '@/src/types/savedItem';

const vocabularyById = new Map(sampleVocabulary.map((item) => [item.id, item]));

type LoadState = 'loading' | 'loaded' | 'error' | 'not-found';

const ITEM_TYPE_LABELS: Record<SavedItemType, string> = {
  word: '单词',
  phrase: '短语',
  sentence: '句子',
};

const SOURCE_TYPE_LABELS: Record<SavedItemSourceType, string> = {
  learning: '学习',
  interview: '面试',
};

export default function SavedItemDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const itemId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [savedItem, setSavedItem] = useState<SavedItem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [retryToken, setRetryToken] = useState(0);
  const lastAutoPlayedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!itemId) {
      setLoadState('not-found');
      return;
    }

    let isCancelled = false;
    setLoadState('loading');

    fetchSavedItem(itemId)
      .then((item) => {
        if (isCancelled) {
          return;
        }
        if (!item) {
          setLoadState('not-found');
          return;
        }
        setSavedItem(item);
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
  }, [itemId, retryToken]);

  const vocabularyItem =
    savedItem?.sourceType === 'learning' && savedItem.sourceId
      ? vocabularyById.get(savedItem.sourceId)
      : undefined;

  // Auto-plays the matched word's pronunciation exactly once per detail. The
  // ref guard protects against React re-running this effect for the same
  // item, e.g. under Strict Mode's double-invocation in development.
  useEffect(() => {
    if (loadState !== 'loaded' || !savedItem || !vocabularyItem) {
      return;
    }

    if (lastAutoPlayedIdRef.current === savedItem.id) {
      return;
    }
    lastAutoPlayedIdRef.current = savedItem.id;

    void playPronunciation(vocabularyItem.pronunciationText ?? vocabularyItem.term);
  }, [loadState, savedItem, vocabularyItem]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {loadState === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={styles.statusText}>正在加载收藏详情…</Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>收藏详情加载失败，请检查网络。</Text>
          <Pressable
            onPress={() => setRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载收藏详情"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'not-found' && (
        <View style={styles.centerContent}>
          <Text style={styles.statusText}>该收藏不存在或你无权访问</Text>
        </View>
      )}

      {loadState === 'loaded' && savedItem && (
        <View style={styles.card}>
          {vocabularyItem ? (
            <>
              <Text style={styles.term}>{vocabularyItem.term}</Text>

              <View style={styles.pronunciationRow}>
                {vocabularyItem.ipa && (
                  <View style={styles.ipaGroup}>
                    <Text style={styles.ipa}>/{vocabularyItem.ipa}/</Text>
                    <Text style={styles.accentBadge}>US</Text>
                  </View>
                )}
                {vocabularyItem.partOfSpeech && (
                  <Text style={styles.partOfSpeech}>{vocabularyItem.partOfSpeech}</Text>
                )}
                <Pressable
                  onPress={() =>
                    playPronunciation(vocabularyItem.pronunciationText ?? vocabularyItem.term)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`播放 ${vocabularyItem.term} 的发音`}
                  hitSlop={8}
                  style={styles.speakerButton}>
                  <SymbolView
                    name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
                    tintColor="#2f95dc"
                    size={20}
                  />
                </Pressable>
              </View>

              <Text style={styles.meaning}>{vocabularyItem.chineseMeaning}</Text>

              {vocabularyItem.englishDefinition && (
                <>
                  <Text style={styles.sectionLabel}>Definition</Text>
                  <Text style={styles.example}>{vocabularyItem.englishDefinition}</Text>
                </>
              )}

              {vocabularyItem.exampleSentence && (
                <>
                  <Text style={styles.sectionLabel}>Example</Text>
                  <Text style={styles.example}>{vocabularyItem.exampleSentence}</Text>
                </>
              )}

              {vocabularyItem.exampleTranslation && (
                <>
                  <Text style={styles.sectionLabel}>翻译</Text>
                  <Text style={styles.translation}>{vocabularyItem.exampleTranslation}</Text>
                </>
              )}

              <Text style={styles.metaLine}>
                {ITEM_TYPE_LABELS[savedItem.itemType]} · 来源：
                {SOURCE_TYPE_LABELS[savedItem.sourceType]}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.pronunciationRow}>
                <Text style={styles.term}>{savedItem.content}</Text>
                <Pressable
                  onPress={() => playPronunciation(savedItem.content)}
                  accessibilityRole="button"
                  accessibilityLabel={`播放 ${savedItem.content} 的发音`}
                  hitSlop={8}
                  style={styles.speakerButton}>
                  <SymbolView
                    name={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
                    tintColor="#2f95dc"
                    size={20}
                  />
                </Pressable>
              </View>

              {savedItem.chineseText && (
                <Text style={styles.meaning}>{savedItem.chineseText}</Text>
              )}

              <Text style={styles.metaLine}>
                {ITEM_TYPE_LABELS[savedItem.itemType]} · 来源：
                {SOURCE_TYPE_LABELS[savedItem.sourceType]}
              </Text>
            </>
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
    backgroundColor: '#F2F2F7',
    padding: 20,
    paddingTop: 24,
  },
  centerContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: '#d9534f',
    textAlign: 'center',
  },
  retryButton: {
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
  card: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 20,
    gap: 8,
  },
  term: {
    fontSize: 26,
    fontWeight: '700',
    color: '#000',
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
  meaning: {
    fontSize: 18,
    fontWeight: '500',
    color: '#3c3c43',
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    marginTop: 16,
  },
  example: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000',
  },
  translation: {
    fontSize: 17,
    lineHeight: 24,
    color: '#3c3c43',
  },
  metaLine: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 16,
  },
});
