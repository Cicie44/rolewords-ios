import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  playPronunciation,
  stopPronunciation,
  type PronunciationCallbacks,
} from '@/src/services/pronunciationService';
import { fetchSavedItem } from '@/src/services/savedItemsService';
import { fetchVocabularyItemById } from '@/src/services/vocabularyService';
import type { SavedItem, SavedItemSourceType, SavedItemType } from '@/src/types/savedItem';
import type { VocabularyItem } from '@/src/types/vocabulary';

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

  // The matched database vocabulary item for a "learning"-sourced bookmark,
  // if any. Its own fetch is independent of savedItem's load state — a
  // failure here (or a genuine no-match) must never fail the whole page,
  // it just falls back to rendering the saved item's own content, same as
  // when sourceId simply doesn't match anything.
  const [vocabularyItem, setVocabularyItem] = useState<VocabularyItem | null>(null);
  const vocabularyRequestTokenRef = useRef(0);

  // Shared playback state for whichever single piece of text this detail
  // page is currently reading aloud (the matched word, or the raw saved
  // content). `isPlayingRef` is the synchronous source of truth used inside
  // handlers — `isPlaying` state only drives the rendered icon.
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const playbackTokenRef = useRef(0);

  useEffect(() => {
    // Eagerly clears the previous item's data the moment a new load
    // starts (new itemId, or a retry) — not just loadState — so a
    // slow-to-resolve vocabulary lookup tied to the old savedItem can
    // never linger and get shown against whatever loads next. Content
    // only ever renders when loadState === 'loaded' regardless, but
    // clearing here removes any dependence on that as the sole guard.
    setSavedItem(null);

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

  // Looks up the database vocabulary item for a "learning"-sourced
  // bookmark. Reruns every time savedItem changes — including the change
  // to null the moment a new item starts loading (see the effect above).
  // The request token is bumped unconditionally as the very first thing
  // this effect does, before any early return, so every one of: a
  // non-"learning" source, a missing sourceId, savedItem going back to
  // null, or a genuine switch to a different item, invalidates whatever
  // lookup was previously in flight — a late arrival can never overwrite
  // what's now displayed. The cleanup function covers the remaining case,
  // unmount (or Expo Router reusing this screen instance while a lookup is
  // still in flight), by bumping the token one more time on the way out.
  // Any failure (network error or a genuine no-match) just leaves
  // vocabularyItem null, falling back to the saved item's own content
  // instead of failing the whole page.
  useEffect(() => {
    const requestToken = (vocabularyRequestTokenRef.current += 1);
    setVocabularyItem(null);

    if (savedItem?.sourceType !== 'learning' || !savedItem.sourceId) {
      return;
    }

    const sourceId = savedItem.sourceId;

    fetchVocabularyItemById(sourceId)
      .then((item) => {
        if (vocabularyRequestTokenRef.current !== requestToken) {
          return;
        }
        setVocabularyItem(item);
      })
      .catch(() => {
        // Deliberately swallowed — see the comment above this effect.
      });

    return () => {
      vocabularyRequestTokenRef.current += 1;
    };
  }, [savedItem]);

  // Starts playback under a fresh token. `isPlayingRef`/`isPlaying` flip to
  // true synchronously (before the async voice lookup even begins) so a
  // user tapping the button again immediately after can still stop it.
  // Every callback below only applies its result if its captured `token` is
  // still the current one — a superseded/late callback from a previous
  // request can never clobber a newer request's UI state.
  const startPlayback = useCallback((text: string) => {
    const token = (playbackTokenRef.current += 1);
    isPlayingRef.current = true;
    setIsPlaying(true);

    const callbacks: PronunciationCallbacks = {
      onStart: () => {
        if (playbackTokenRef.current !== token) {
          return;
        }
        isPlayingRef.current = true;
        setIsPlaying(true);
      },
      onDone: () => {
        if (playbackTokenRef.current !== token) {
          return;
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
      },
      onStopped: () => {
        if (playbackTokenRef.current !== token) {
          return;
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
      },
      onError: () => {
        if (playbackTokenRef.current !== token) {
          return;
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
      },
    };

    void playPronunciation(text, callbacks);
  }, []);

  // `isPlayingRef` (not the async `isPlaying` state) gates this so two rapid
  // taps can never both read "not playing" and both start playback.
  const handleTogglePlayback = useCallback(
    (text: string) => {
      if (isPlayingRef.current) {
        playbackTokenRef.current += 1;
        isPlayingRef.current = false;
        setIsPlaying(false);
        void stopPronunciation();
        return;
      }
      startPlayback(text);
    },
    [startPlayback],
  );

  // Stops playback whenever this screen loses focus, is unmounted, or
  // navigates to a different saved item while staying mounted (itemId is a
  // dependency of this callback, so React Navigation's focus effect tears
  // down and re-registers whenever it changes while still focused).
  useFocusEffect(
    useCallback(() => {
      return () => {
        playbackTokenRef.current += 1;
        isPlayingRef.current = false;
        setIsPlaying(false);
        void stopPronunciation();
      };
    }, [itemId]),
  );

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

    startPlayback(vocabularyItem.pronunciationText ?? vocabularyItem.term);
  }, [loadState, savedItem, vocabularyItem, startPlayback]);

  const isLongFormContent = !vocabularyItem && savedItem?.itemType === 'sentence';

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
                    handleTogglePlayback(vocabularyItem.pronunciationText ?? vocabularyItem.term)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPlaying ? '停止朗读' : `播放 ${vocabularyItem.term} 的发音`
                  }
                  hitSlop={8}
                  style={styles.speakerButton}>
                  <SymbolView
                    name={{
                      ios: isPlaying ? 'stop.circle.fill' : 'speaker.wave.2.fill',
                      android: isPlaying ? 'stop_circle' : 'volume_up',
                      web: isPlaying ? 'stop_circle' : 'volume_up',
                    }}
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
          ) : isLongFormContent ? (
            <>
              <View style={styles.longFormHeaderRow}>
                <Text style={styles.longFormLabel}>英文内容</Text>
                <Pressable
                  onPress={() => handleTogglePlayback(savedItem.content)}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? '停止朗读' : '朗读收藏内容'}
                  hitSlop={8}
                  style={styles.speakerButton}>
                  <SymbolView
                    name={{
                      ios: isPlaying ? 'stop.circle.fill' : 'speaker.wave.2.fill',
                      android: isPlaying ? 'stop_circle' : 'volume_up',
                      web: isPlaying ? 'stop_circle' : 'volume_up',
                    }}
                    tintColor="#2f95dc"
                    size={20}
                  />
                </Pressable>
              </View>

              <Text style={styles.longFormContent} selectable>
                {savedItem.content}
              </Text>

              {savedItem.chineseText && (
                <Text style={styles.meaning}>{savedItem.chineseText}</Text>
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
                  onPress={() => handleTogglePlayback(savedItem.content)}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? '停止朗读' : `播放 ${savedItem.content} 的发音`}
                  hitSlop={8}
                  style={styles.speakerButton}>
                  <SymbolView
                    name={{
                      ios: isPlaying ? 'stop.circle.fill' : 'speaker.wave.2.fill',
                      android: isPlaying ? 'stop_circle' : 'volume_up',
                      web: isPlaying ? 'stop_circle' : 'volume_up',
                    }}
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
    flexShrink: 1,
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
  longFormHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  longFormLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
  },
  longFormContent: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '400',
    color: '#000',
  },
});
