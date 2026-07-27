import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { deleteSavedItems, fetchSavedItems } from '@/src/services/savedItemsService';
import type { SavedItem, SavedItemSourceType, SavedItemType } from '@/src/types/savedItem';

type LoadState = 'loading' | 'loaded' | 'error';

const ITEM_TYPE_LABELS: Record<SavedItemType, string> = {
  word: '单词',
  phrase: '短语',
  sentence: '句子',
};

const SOURCE_TYPE_LABELS: Record<SavedItemSourceType, string> = {
  learning: '学习',
  interview: '面试',
};

export default function SavedScreen() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [retryToken, setRetryToken] = useState(0);
  const [isManaging, setIsManaging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Refreshes every time the Saved tab regains focus. `retryToken` is a
  // dependency purely so the retry button can force a reload:
  // useFocusEffect's internal effect depends on this callback's identity, so
  // bumping the token makes it clean up the in-flight request (via the
  // returned cleanup) and immediately restart — calling loadItems() directly
  // would not do this, since its cleanup is only ever wired up through
  // useFocusEffect itself.
  const loadItems = useCallback(() => {
    let isActive = true;
    setLoadState('loading');

    fetchSavedItems()
      .then((fetched) => {
        if (!isActive) {
          return;
        }
        setItems(fetched);
        setLoadState('loaded');
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setLoadState('error');
      });

    return () => {
      isActive = false;
    };
  }, [retryToken]);

  useFocusEffect(loadItems);

  const handleToggleManaging = () => {
    if (isBulkDeleting) {
      return;
    }
    setIsManaging((prev) => !prev);
    setSelectedIds(new Set());
    setBulkError(null);
  };

  const handleToggleSelect = (id: string) => {
    if (isBulkDeleting) {
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const handleToggleSelectAll = () => {
    if (isBulkDeleting) {
      return;
    }
    setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  };

  const handleRowPress = (item: SavedItem) => {
    if (isBulkDeleting) {
      return;
    }
    if (isManaging) {
      handleToggleSelect(item.id);
      return;
    }
    router.push({ pathname: '/saved/[id]', params: { id: item.id } });
  };

  const handleBulkDelete = () => {
    if (isBulkDeleting || selectedIds.size === 0) {
      return;
    }

    const idsToDelete = Array.from(selectedIds);

    Alert.alert('移除收藏', `确定移除选中的 ${idsToDelete.length} 项吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsBulkDeleting(true);
            setBulkError(null);

            try {
              await deleteSavedItems(idsToDelete);
            } catch {
              setBulkError('批量移除失败，请检查网络后重试。');
              setIsBulkDeleting(false);
              return;
            }

            setItems((prev) => prev.filter((item) => !idsToDelete.includes(item.id)));
            setSelectedIds(new Set());
            setIsManaging(false);
            setIsBulkDeleting(false);
          })();
        },
      },
    ]);
  };

  const showManageButton = loadState === 'loaded' && items.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {isManaging ? (
          <Pressable
            onPress={handleToggleSelectAll}
            disabled={isBulkDeleting}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? '取消全选' : '全选'}
            hitSlop={10}
            style={styles.selectAllButton}>
            <Text style={styles.selectAllButtonText}>{allSelected ? '取消全选' : '全选'}</Text>
          </Pressable>
        ) : loadState === 'loaded' ? (
          <Text style={styles.subtitle}>共 {items.length} 项收藏</Text>
        ) : (
          <View />
        )}

        <View style={styles.headerRight}>
          {isManaging && (
            <Text style={styles.selectedCountText}>
              已选 {selectedIds.size} / {items.length} 项
            </Text>
          )}

          {showManageButton && (
            <Pressable
              onPress={handleToggleManaging}
              disabled={isBulkDeleting}
              accessibilityRole="button"
              accessibilityLabel={isManaging ? '完成管理' : '管理生词本'}
              style={styles.manageButton}>
              <Text style={styles.manageButtonText}>{isManaging ? '完成' : '管理'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loadState === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={styles.statusText}>正在加载生词本…</Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>生词本加载失败，请检查网络。</Text>
          <Pressable
            onPress={() => setRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载生词本"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'loaded' && items.length === 0 && (
        <View style={styles.centerContent}>
          <Text style={styles.statusText}>还没有收藏内容</Text>
        </View>
      )}

      {loadState === 'loaded' && items.length > 0 && (
        <>
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={items}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => {
              const isSelected = selectedIds.has(item.id);

              return (
                <Pressable
                  onPress={() => handleRowPress(item)}
                  disabled={isBulkDeleting}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isManaging
                      ? `${isSelected ? '取消选择' : '选择'} ${item.content}`
                      : `查看 ${item.content} 详情`
                  }
                  style={[styles.row, isBulkDeleting && styles.disabledOpacity]}>
                  {isManaging && (
                    <SymbolView
                      name={{
                        ios: isSelected ? 'checkmark.circle.fill' : 'circle',
                        android: isSelected ? 'check_circle' : 'radio_button_unchecked',
                        web: isSelected ? 'check_circle' : 'radio_button_unchecked',
                      }}
                      tintColor={isSelected ? '#2f95dc' : '#c7c7cc'}
                      size={22}
                    />
                  )}

                  <View style={styles.rowTextGroup}>
                    <Text style={styles.itemContent}>{item.content}</Text>
                    {item.chineseText && (
                      <Text style={styles.itemChinese}>{item.chineseText}</Text>
                    )}
                    <Text style={styles.itemMeta}>
                      {ITEM_TYPE_LABELS[item.itemType]} · 来源：
                      {SOURCE_TYPE_LABELS[item.sourceType]}
                    </Text>
                  </View>

                  {!isManaging && (
                    <SymbolView
                      name={{
                        ios: 'chevron.right',
                        android: 'chevron_right',
                        web: 'chevron_right',
                      }}
                      tintColor="#c7c7cc"
                      size={14}
                    />
                  )}
                </Pressable>
              );
            }}
          />

          {isManaging && (
            <View style={styles.bulkActionBar}>
              {bulkError && <Text style={styles.errorText}>{bulkError}</Text>}
              <Pressable
                onPress={handleBulkDelete}
                disabled={isBulkDeleting || selectedIds.size === 0}
                accessibilityRole="button"
                accessibilityLabel={
                  selectedIds.size > 0 ? `移除选中的 ${selectedIds.size} 项` : '移除选中项'
                }
                style={[
                  styles.bulkDeleteButton,
                  selectedIds.size > 0
                    ? styles.bulkDeleteButtonDestructive
                    : styles.bulkDeleteButtonNeutral,
                  isBulkDeleting && styles.disabledOpacity,
                ]}>
                <Text
                  style={[
                    styles.bulkDeleteButtonText,
                    selectedIds.size > 0
                      ? styles.bulkDeleteButtonTextDestructive
                      : styles.bulkDeleteButtonTextNeutral,
                  ]}>
                  {isBulkDeleting
                    ? '正在移除…'
                    : selectedIds.size > 0
                      ? `移除选中的 ${selectedIds.size} 项`
                      : '移除选中项'}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
    marginBottom: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  manageButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  manageButtonText: {
    fontSize: 16,
    color: '#2f95dc',
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 15,
    color: '#8e8e93',
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
  selectAllButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  selectAllButtonText: {
    fontSize: 15,
    color: '#2f95dc',
    fontWeight: '600',
  },
  selectedCountText: {
    fontSize: 13,
    color: '#8e8e93',
  },
  list: {
    flex: 1,
  },
  // Only the actual rows get the white rounded background — since this
  // sizes to content (no flexGrow), it never stretches past the last row,
  // and any leftover space below stays the page's gray.
  listContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#fff',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#c6c6c8',
    marginLeft: 16,
  },
  rowTextGroup: {
    flex: 1,
    gap: 4,
  },
  itemContent: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  itemChinese: {
    fontSize: 15,
    color: '#3c3c43',
  },
  itemMeta: {
    fontSize: 12,
    color: '#8e8e93',
  },
  disabledOpacity: {
    opacity: 0.5,
  },
  bulkActionBar: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#c6c6c8',
    marginHorizontal: -16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  bulkDeleteButton: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  bulkDeleteButtonNeutral: {
    backgroundColor: '#e5e5ea',
  },
  bulkDeleteButtonDestructive: {
    backgroundColor: '#ff3b30',
  },
  bulkDeleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  bulkDeleteButtonTextNeutral: {
    color: '#8e8e93',
  },
  bulkDeleteButtonTextDestructive: {
    color: '#fff',
  },
});
