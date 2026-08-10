import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyReviewAnswer, createReviewSession, isReviewSessionComplete } from '@/src/features/learning/reviewSession';
import { REVIEW_GROUP_SIZE } from '@/src/features/learning/constants';

test('Review 组不引入新词：只处理调用方传入的到期词列表', () => {
  const due = ['r1', 'r2', 'r3'];
  const session = createReviewSession('book', 's1', due);

  assert.equal(session.totalCount, 3);
  assert.deepEqual(session.remainingQueue, due);
  assert.equal(isReviewSessionComplete(session), false);
});

test('每个到期词在一组内只判断一次，最终 reviewedWordIds 与到期顺序一致', () => {
  const due = ['r1', 'r2', 'r3'];
  let session = createReviewSession('book', 's2', due);

  for (const wordId of due) {
    const next = applyReviewAnswer(session, wordId, 'known');
    assert.ok(next, `${wordId} 应能被正常判定`);
    session = next!;
  }

  assert.equal(isReviewSessionComplete(session), true);
  assert.deepEqual(session.reviewedWordIds, due);
  assert.equal(session.remainingQueue.length, 0);
});

test('对已经判定过的词再次判定会被拒绝（返回 null，不重复计数）', () => {
  const due = ['r1', 'r2'];
  let session = createReviewSession('book', 's3', due);

  const first = applyReviewAnswer(session, 'r1', 'known')!;
  session = first;

  // r1 已经不在队首（现在是 r2），重复判定 r1 应被拒绝。
  const repeat = applyReviewAnswer(session, 'r1', 'known');
  assert.equal(repeat, null);
  assert.deepEqual(session.reviewedWordIds, ['r1'], '重复判定不应影响已记录的结果');
});

test('一组最多 10 个：REVIEW_GROUP_SIZE 常量维持为 10（由调用方在构造 session 前截断到期词列表）', () => {
  assert.equal(REVIEW_GROUP_SIZE, 10);
});

test('unknown / fuzzy / known 三种结果分别计数', () => {
  const due = ['r1', 'r2', 'r3'];
  let session = createReviewSession('book', 's4', due);
  session = applyReviewAnswer(session, 'r1', 'unknown')!;
  session = applyReviewAnswer(session, 'r2', 'fuzzy')!;
  session = applyReviewAnswer(session, 'r3', 'known')!;

  assert.equal(session.unknownCount, 1);
  assert.equal(session.fuzzyCount, 1);
  assert.equal(session.knownCount, 1);
});
