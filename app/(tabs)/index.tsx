import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { sampleVocabulary } from '@/src/data/sampleVocabulary';
import { wordBooks } from '@/src/data/wordBooks';
import { playPronunciation } from '@/src/services/pronunciationService';

export default function LearnScreen() {
  const [selectedWordBookId, setSelectedWordBookId] = useState(wordBooks[0].id);

  const selectedWordBook = wordBooks.find((book) => book.id === selectedWordBookId)!;

  const wordsInBook = useMemo(
    () => sampleVocabulary.filter((item) => item.wordBookId === selectedWordBookId),
    [selectedWordBookId],
  );

  const currentWord = wordsInBook[0];

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
        <Text style={styles.wordBookCount}>共 {wordsInBook.length} 个测试单词</Text>
      </View>

      {currentWord && (
        <View style={styles.card}>
          <Text style={styles.word}>{currentWord.term}</Text>

          <View style={styles.pronunciationRow}>
            {currentWord.ipa && <Text style={styles.ipa}>/{currentWord.ipa}/</Text>}
            {currentWord.partOfSpeech && (
              <Text style={styles.partOfSpeech}>{currentWord.partOfSpeech}</Text>
            )}
            <Pressable
              onPress={() => playPronunciation(currentWord.pronunciationText ?? currentWord.term)}
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

          <Text style={styles.meaning}>中文：{currentWord.chineseMeaning}</Text>

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
  ipa: {
    fontSize: 15,
    color: '#666',
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
});
