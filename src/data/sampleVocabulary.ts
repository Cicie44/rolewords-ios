import type { VocabularyItem } from '@/src/types/vocabulary';
import aiResearch from '@/src/data/vocabulary/aiResearch.json';
import developer from '@/src/data/vocabulary/developer.json';
import projectManager from '@/src/data/vocabulary/projectManager.json';

export const sampleVocabulary: VocabularyItem[] = [
  ...(developer as VocabularyItem[]),
  ...(projectManager as VocabularyItem[]),
  ...(aiResearch as VocabularyItem[]),
];
