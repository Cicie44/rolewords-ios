import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { deleteSavedItems, fetchSavedItems } from '@/src/services/savedItemsService';
import type { SavedItem, SavedItemSourceType, SavedItemType } from '@/src/types/savedItem';

// Same restrained, warm-gray/ink-green iOS-native palette as the Learn page.
// Scoped to this screen only — no global theme system, no effect on other pages.
const COLORS = {
  background: '#F6F3EE',
  surface: '#FFFFFF',
  ink: '#1E362F',
  inkSoft: '#4B6358',
  accent: '#48715F',
  accentSoft: '#E4EEE8',
  gray: '#66666A',
  grayTrack: '#EDEAE4',
  border: '#E2DED7',
  danger: '#B3483F',
};

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
          <ActivityIndicator color={COLORS.ink} />
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
          <Text style={styles.statusSubText}>在学习或面试准备中收藏的内容会显示在这里。</Text>
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
              const lineLimit = item.itemType === 'sentence' ? 3 : 2;

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
                  accessibilityState={
                    isManaging
                      ? { selected: isSelected, disabled: isBulkDeleting }
                      : { disabled: isBulkDeleting }
                  }
                  style={[styles.row, isBulkDeleting && styles.disabledOpacity]}>
                  {isManaging && (
                    <SymbolView
                      name={{
                        ios: isSelected ? 'checkmark.circle.fill' : 'circle',
                        android: isSelected ? 'check_circle' : 'radio_button_unchecked',
                        web: isSelected ? 'check_circle' : 'radio_button_unchecked',
                      }}
                      tintColor={isSelected ? COLORS.ink : COLORS.gray}
                      size={22}
                    />
                  )}

                  <View style={styles.rowTextGroup}>
                    <Text
                      style={[
                        styles.itemContent,
                        item.itemType === 'sentence' && styles.sentenceContent,
                      ]}
                      numberOfLines={lineLimit}
                      ellipsizeMode="tail">
                      {item.content}
                    </Text>
                    {item.chineseText && (
                      <Text style={styles.itemChinese}>{item.chineseText}</Text>
                    )}
                    <View style={styles.metaRow}>
                      <View style={styles.metaTag}>
                        <Text style={styles.metaTagText}>{ITEM_TYPE_LABELS[item.itemType]}</Text>
                      </View>
                      <View style={styles.metaTag}>
                        <Text style={styles.metaTagText}>{SOURCE_TYPE_LABELS[item.sourceType]}</Text>
                      </View>
                    </View>
                  </View>

                  {!isManaging && (
                    <SymbolView
                      name={{
                        ios: 'chevron.right',
                        android: 'chevron_right',
                        web: 'chevron_right',
                      }}
                      tintColor={COLORS.gray}
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
    backgroundColor: COLORS.background,
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
    color: COLORS.gray,
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
    color: COLORS.ink,
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 15,
    color: COLORS.gray,
    textAlign: 'center',
  },
  statusSubText: {
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: COLORS.danger,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
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
    color: COLORS.ink,
    fontWeight: '600',
  },
  selectedCountText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  list: {
    flex: 1,
  },
  // Only the actual rows get the white rounded background — since this
  // sizes to content (no flexGrow), it never stretches past the last row,
  // and any leftover space below stays the page's warm-gray background.
  listContent: {
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.surface,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: 16,
  },
  rowTextGroup: {
    flex: 1,
    gap: 4,
  },
  itemContent: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.ink,
  },
  sentenceContent: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },
  itemChinese: {
    fontSize: 15,
    color: COLORS.inkSoft,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  metaTag: {
    borderRadius: 6,
    backgroundColor: COLORS.grayTrack,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaTagText: {
    fontSize: 11,
    color: COLORS.gray,
  },
  disabledOpacity: {
    opacity: 0.5,
  },
  bulkActionBar: {
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
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
    backgroundColor: COLORS.grayTrack,
  },
  bulkDeleteButtonDestructive: {
    backgroundColor: COLORS.danger,
  },
  bulkDeleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  bulkDeleteButtonTextNeutral: {
    color: COLORS.gray,
  },
  bulkDeleteButtonTextDestructive: {
    color: '#fff',
  },
});
