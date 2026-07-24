export interface WordBook {
  id: string;
  title: string;
  chineseTitle: string;
  description: string;
  category: string;
}

export interface VocabularyItem {
  id: string;
  term: string;
  chineseMeaning: string;
  partOfSpeech?: string;
  englishDefinition?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  wordBookId: string;
  tags: string[];
  /** IPA transcription without surrounding slashes, e.g. "ˈsteɪkˌhoʊldər". */
  ipa?: string;
  /** Overrides what gets read aloud, for abbreviations or terms that shouldn't be read as spelled. */
  pronunciationText?: string;
}

export type LearningStatus = 'new' | 'learning' | 'mastered';

export type Familiarity = 'unknown' | 'fuzzy' | 'known';

export interface UserWordProgress {
  vocabularyItemId: string;
  status: LearningStatus;
  familiarity: Familiarity;
  reviewCount: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
}
