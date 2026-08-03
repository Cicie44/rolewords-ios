export type SavedItemType = 'word' | 'phrase' | 'sentence';

export type SavedItemSourceType = 'learning' | 'interview';

export interface SavedItem {
  id: string;
  itemType: SavedItemType;
  content: string;
  chineseText?: string;
  sourceType: SavedItemSourceType;
  sourceId?: string;
  createdAt: string;
}

export interface CreateSavedItemInput {
  itemType: SavedItemType;
  content: string;
  chineseText?: string;
  sourceType: SavedItemSourceType;
  sourceId?: string;
}

export interface GenerateSavedItemChineseTextInput {
  content: string;
  itemType: SavedItemType;
  context?: string;
}
