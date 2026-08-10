import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeNextReviewAt,
  isEligibleForReview,
  isLearnCarryover,
  isNewWord,
  nextLearningStatus,
  nextRecognitionCount,
} from '@/src/features/learning/reviewSchedule';
import { MAX_RECOGNITION_COUNT } from '@/src/features/learning/constants';
import type { UserWordProgress } from '@/src/types/vocabulary';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const NOW_MS = NOW.getTime();

function isoPlusMs(ms: number): string {
  return new Date(NOW_MS + ms).toISOString();
}

test('unknown/fuzzy/known 的复习间隔计算正确', () => {
  assert.equal(computeNextReviewAt('unknown', 0, NOW), isoPlusMs(10 * 60 * 1000), 'unknown -> 10 分钟');
  assert.equal(computeNextReviewAt('fuzzy', 1, NOW), isoPlusMs(24 * 60 * 60 * 1000), 'fuzzy -> 1 天');
  assert.equal(computeNextReviewAt('known', 1, NOW), isoPlusMs(1 * 24 * 60 * 60 * 1000), 'known(streak=1) -> 1 天');
  assert.equal(computeNextReviewAt('known', 2, NOW), isoPlusMs(3 * 24 * 60 * 60 * 1000), 'known(streak=2) -> 3 天');
  assert.equal(computeNextReviewAt('known', 3, NOW), isoPlusMs(7 * 24 * 60 * 60 * 1000), 'known(streak=3) -> 7 天');
});

test('mastered 单词按 nextReviewAt 进入 Review：未到期不出现，到期后出现', () => {
  let recognitionCount = 0;
  for (let i = 0; i < 3; i += 1) {
    recognitionCount = nextRecognitionCount('known', recognitionCount);
  }
  assert.equal(recognitionCount, MAX_RECOGNITION_COUNT);
  assert.equal(nextLearningStatus(recognitionCount), 'mastered');

  const nextReviewAt = computeNextReviewAt('known', recognitionCount, NOW);
  assert.equal(nextReviewAt, isoPlusMs(7 * 24 * 60 * 60 * 1000));

  const progress: UserWordProgress = {
    vocabularyItemId: 'w-mastered',
    status: 'mastered',
    familiarity: 'known',
    reviewCount: 3,
    recognitionCount,
    lastReviewedAt: NOW.toISOString(),
    nextReviewAt,
    needsLearnReinforcement: false,
  };

  assert.equal(isEligibleForReview(progress, Date.parse(nextReviewAt) - 1), false, '到期前一毫秒仍不出现');
  assert.equal(isEligibleForReview(progress, Date.parse(nextReviewAt)), true, '到期瞬间即出现');
});

test('new / carryover / due-review 三类互斥', () => {
  const cases: Array<{ label: string; progress: UserWordProgress | undefined }> = [
    { label: '全新词（无 progress）', progress: undefined },
    {
      label: '标准新词',
      progress: {
        vocabularyItemId: 'a',
        status: 'new',
        familiarity: 'unknown',
        reviewCount: 0,
        recognitionCount: 0,
        needsLearnReinforcement: false,
      },
    },
    {
      label: '遗留脏数据：status 仍是 new 但 reviewCount > 0',
      progress: {
        vocabularyItemId: 'b',
        status: 'new',
        familiarity: 'fuzzy',
        reviewCount: 2,
        recognitionCount: 0,
        needsLearnReinforcement: false,
      },
    },
    {
      label: 'Learn carryover（未完成的巩固词）',
      progress: {
        vocabularyItemId: 'c',
        status: 'learning',
        familiarity: 'unknown',
        reviewCount: 1,
        recognitionCount: 1,
        needsLearnReinforcement: true,
      },
    },
    {
      label: '学习中但未到期',
      progress: {
        vocabularyItemId: 'd',
        status: 'learning',
        familiarity: 'fuzzy',
        reviewCount: 1,
        recognitionCount: 1,
        nextReviewAt: isoPlusMs(60 * 1000),
        needsLearnReinforcement: false,
      },
    },
    {
      label: '已到期的复习词',
      progress: {
        vocabularyItemId: 'e',
        status: 'learning',
        familiarity: 'fuzzy',
        reviewCount: 1,
        recognitionCount: 1,
        nextReviewAt: isoPlusMs(-60 * 1000),
        needsLearnReinforcement: false,
      },
    },
  ];

  for (const { label, progress } of cases) {
    const flags = [isNewWord(progress), isLearnCarryover(progress), isEligibleForReview(progress, NOW_MS)];
    const trueCount = flags.filter(Boolean).length;
    assert.ok(trueCount <= 1, `${label}: 三类标记应互斥，实际同时为 true 的数量为 ${trueCount} (${flags})`);
  }

  assert.equal(isNewWord(undefined), true);
  assert.equal(isLearnCarryover(undefined), false);
  assert.equal(isEligibleForReview(undefined, NOW_MS), false);
});
