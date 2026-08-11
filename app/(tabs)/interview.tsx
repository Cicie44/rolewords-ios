import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchInterviewSessions } from '@/src/services/interviewService';
import type { InterviewSessionStatus, InterviewSessionSummary } from '@/src/types/interview';

const COLORS = {
  background: '#F6F3EE',
  surface: '#FFFFFF',
  ink: '#1E362F',
  inkSoft: '#4B6358',
  accent: '#48715F',
  accentSoft: '#E4EEE8',
  warm: '#B9814F',
  warmDark: '#8C5C2E',
  warmSoft: '#F5E9DA',
  gray: '#66666A',
  grayTrack: '#EDEAE4',
  border: '#E2DED7',
  danger: '#B3483F',
  dangerSoft: '#F7E8E6',
};

type HistoryLoadState = 'loading' | 'loaded' | 'error';

const STATUS_LABELS: Record<InterviewSessionStatus, string> = {
  draft: '草稿',
  questions_ready: '已生成问题',
  answers_ready: '已生成答案',
  completed: '已完成',
  failed: '失败',
};

// Purely a display mapping — introduces no new business states or rules,
// just how each existing InterviewSessionStatus renders as a small badge.
const STATUS_BADGE_STYLES: Record<InterviewSessionStatus, { backgroundColor: string; color: string }> = {
  draft: { backgroundColor: COLORS.grayTrack, color: COLORS.gray },
  questions_ready: { backgroundColor: COLORS.warmSoft, color: COLORS.warmDark },
  answers_ready: { backgroundColor: COLORS.accentSoft, color: COLORS.accent },
  completed: { backgroundColor: COLORS.accentSoft, color: COLORS.accent },
  failed: { backgroundColor: COLORS.dangerSoft, color: COLORS.danger },
};

function formatSessionDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function InterviewScreen() {
  const [sessions, setSessions] = useState<InterviewSessionSummary[]>([]);
  const [loadState, setLoadState] = useState<HistoryLoadState>('loading');
  const [retryToken, setRetryToken] = useState(0);

  // Refreshes every time the "面试" tab regains focus (e.g. returning from
  // the new-session form or a detail page). `retryToken` is a dependency
  // purely so the retry button can force a reload: useFocusEffect's internal
  // effect depends on this callback's identity, so bumping the token makes
  // it clean up the in-flight request (via the returned cleanup) and
  // immediately restart — calling loadSessions() directly would not do
  // this, since its cleanup is only ever wired up through useFocusEffect.
  const loadSessions = useCallback(() => {
    let isActive = true;
    setLoadState('loading');

    fetchInterviewSessions()
      .then((fetched) => {
        if (!isActive) {
          return;
        }
        setSessions(fetched);
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

  useFocusEffect(loadSessions);

  const handlePressNew = () => {
    router.push('/interview/new');
  };

  const handlePressSession = (item: InterviewSessionSummary) => {
    router.push({
      pathname: '/interview/[id]',
      params: {
        id: item.id,
        jobTitle: item.jobTitle,
        companyName: item.companyName,
      },
    });
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handlePressNew}
        accessibilityRole="button"
        accessibilityLabel="新建面试准备"
        style={styles.newButton}>
        <Text style={styles.newButtonText}>新建面试准备</Text>
      </Pressable>

      {loadState === 'loading' && (
        <View style={styles.centerContent}>
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.statusText}>正在加载面试记录…</Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>面试记录加载失败，请检查网络。</Text>
          <Pressable
            onPress={() => setRetryToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="重试加载面试记录"
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'loaded' && sessions.length === 0 && (
        <View style={styles.centerContent}>
          <Text style={styles.statusText}>还没有面试记录</Text>
          <Text style={styles.statusSubText}>创建一次面试准备后，会显示在这里。</Text>
        </View>
      )}

      {loadState === 'loaded' && sessions.length > 0 && (
        <>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>历史记录</Text>
            <Text style={styles.historyCount}>共 {sessions.length} 条</Text>
          </View>

          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={sessions}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handlePressSession(item)}
                accessibilityRole="button"
                accessibilityLabel={`查看 ${item.companyName} ${item.jobTitle} 详情`}
                style={styles.row}>
                <View style={styles.rowTextGroup}>
                  <Text style={styles.companyName} numberOfLines={1}>
                    {item.companyName}
                  </Text>
                  <Text style={styles.jobTitle} numberOfLines={1}>
                    {item.jobTitle}
                  </Text>
                  <View style={styles.rowMetaRow}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: STATUS_BADGE_STYLES[item.status].backgroundColor },
                      ]}>
                      <Text
                        style={[styles.statusBadgeText, { color: STATUS_BADGE_STYLES[item.status].color }]}>
                        {STATUS_LABELS[item.status]}
                      </Text>
                    </View>
                    <Text style={styles.rowMeta}>{formatSessionDate(item.createdAt)}</Text>
                  </View>
                </View>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  tintColor={COLORS.gray}
                  size={14}
                />
              </Pressable>
            )}
          />
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
  newButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  newButtonText: {
    color: COLORS.surface,
    fontSize: 16,
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
    color: COLORS.inkSoft,
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
    color: COLORS.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.ink,
  },
  historyCount: {
    fontSize: 13,
    color: COLORS.gray,
  },
  list: {
    flex: 1,
  },
  // Only the actual rows get the white rounded background — since this
  // sizes to content (no flexGrow), it never stretches past the last row,
  // and any leftover space below stays the page's warm gray.
  listContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
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
  companyName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.ink,
  },
  jobTitle: {
    fontSize: 14,
    color: COLORS.inkSoft,
  },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    color: COLORS.gray,
  },
});
