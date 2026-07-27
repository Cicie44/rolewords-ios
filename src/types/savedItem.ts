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
