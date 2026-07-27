import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type { CreateSavedItemInput, SavedItem } from '@/src/types/savedItem';

type SavedItemRow = Database['public']['Tables']['saved_items']['Row'];

type SelectedSavedItemRow = Pick<
  SavedItemRow,
  'id' | 'item_type' | 'content' | 'chinese_text' | 'source_type' | 'source_id' | 'created_at'
>;

const SELECT_COLUMNS = 'id, item_type, content, chinese_text, source_type, source_id, created_at';

// Converts one database row (snake_case) into the app's business type
// (camelCase), turning nullable columns into undefined.
function rowToSavedItem(row: SelectedSavedItemRow): SavedItem {
  return {
    id: row.id,
    itemType: row.item_type as SavedItem['itemType'],
    content: row.content,
    chineseText: row.chinese_text ?? undefined,
    sourceType: row.source_type as SavedItem['sourceType'],
    sourceId: row.source_id ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Fetches the current user's saved items, newest first. RLS restricts the
 * query to rows owned by the signed-in user, so there is no userId parameter.
 */
export async function fetchSavedItems(): Promise<SavedItem[]> {
  const { data, error } = await supabase
    .from('saved_items')
    .select<string, SelectedSavedItemRow>(SELECT_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch saved items.');
  }

  if (!data) {
    return [];
  }

  return data.map(rowToSavedItem);
}

/**
 * Saves (or updates) a bookmark for the current user. Requires an active
 * session — user_id always comes from that session, never from the caller.
 * Re-saving the same content for the same user updates the existing row
 * instead of creating a duplicate.
 */
export async function saveSavedItem(input: CreateSavedItemInput): Promise<SavedItem> {
  const trimmedContent = input.content.trim();
  if (trimmedContent.length === 0) {
    throw new Error('Content cannot be empty.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('saved_items')
    .upsert(
      {
        user_id: session.user.id,
        item_type: input.itemType,
        content: trimmedContent,
        chinese_text: input.chineseText ? input.chineseText : null,
        source_type: input.sourceType,
        source_id: input.sourceId ? input.sourceId : null,
      },
      { onConflict: 'user_id,content' },
    )
    .select<string, SelectedSavedItemRow>(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('Failed to save item.');
  }

  return rowToSavedItem(data);
}

/**
 * Deletes one saved item, scoped to both its id and the current user. RLS is
 * still the final authority regardless of these filters.
 */
export async function deleteSavedItem(id: string): Promise<void> {
  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    throw new Error('Id cannot be empty.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { error } = await supabase
    .from('saved_items')
    .delete()
    .eq('id', trimmedId)
    .eq('user_id', session.user.id);

  if (error) {
    throw new Error('Failed to delete item.');
  }
}

/**
 * Fetches one saved item by id. RLS scopes the lookup to the current user, so
 * a row that doesn't exist and a row owned by someone else are
 * indistinguishable from the caller's side — both resolve to null rather
 * than leaking whether the id exists at all.
 */
export async function fetchSavedItem(id: string): Promise<SavedItem | null> {
  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    throw new Error('Id cannot be empty.');
  }

  const { data, error } = await supabase
    .from('saved_items')
    .select<string, SelectedSavedItemRow>(SELECT_COLUMNS)
    .eq('id', trimmedId)
    .maybeSingle();

  if (error) {
    throw new Error('Failed to fetch saved item.');
  }

  if (!data) {
    return null;
  }

  return rowToSavedItem(data);
}

/**
 * Deletes multiple saved items in a single request, scoped to the current
 * user. A no-op for an empty (or all-blank) list — this never issues an
 * unscoped delete, and RLS is still the final authority regardless of these
 * filters.
 */
export async function deleteSavedItems(ids: string[]): Promise<void> {
  const normalizedIds = Array.from(
    new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)),
  );

  if (normalizedIds.length === 0) {
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { error } = await supabase
    .from('saved_items')
    .delete()
    .eq('user_id', session.user.id)
    .in('id', normalizedIds);

  if (error) {
    throw new Error('Failed to delete items.');
  }
}
