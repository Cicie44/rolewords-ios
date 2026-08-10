import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyLearnAnswer, createLearnSession, type LearnAnswerResult } from '@/src/features/learning/learnSession';
import {
  INITIAL_NEW_WORD_BOOTSTRAP_COUNT,
  LEARN_TARGET_COMPLETED,
  MAX_CONSECUTIVE_NEW_CARDS,
  MAX_PRESENTATIONS_PER_WORD,
  MAX_RECOGNITION_COUNT,
  MAX_TOTAL_PRESENTATIONS_PER_GROUP,
  MAX_UNIQUE_WORDS_PER_GROUP,
} from '@/src/features/learning/constants';
import { nextRecognitionCount } from '@/src/features/learning/reviewSchedule';
import type { LearnSession } from '@/src/types/learningSession';
import type { Familiarity } from '@/src/types/vocabulary';

function wordIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

/**
 * Drives a session forward using a caller-supplied familiarity policy,
 * tracking each word's cumulative recognitionCount exactly the way the real
 * Learn screen combines reviewSchedule.nextRecognitionCount with
 * learnSession.applyLearnAnswer (isCompleted = recognitionCount reaching the
 * cap). Returns every step's result, in order, plus the final session.
 */
function runSession(
  initialSession: LearnSession,
  policy: (wordId: string, presentationsSoFar: number) => Familiarity,
  maxSteps = 500,
): { steps: LearnAnswerResult[]; finalSession: LearnSession } {
  const recognitionCounts = new Map<string, number>();
  let session = initialSession;
  const steps: LearnAnswerResult[] = [];

  for (let i = 0; i < maxSteps; i += 1) {
    const wordId = session.currentWordId;
    if (!wordId) {
      return { steps, finalSession: session };
    }
    const presentationsSoFar = session.presentationCounts[wordId] ?? 0;
    const familiarity = policy(wordId, presentationsSoFar);
    const prevRecognition = recognitionCounts.get(wordId) ?? 0;
    const nextRecognition = nextRecognitionCount(familiarity, prevRecognition);
    recognitionCounts.set(wordId, nextRecognition);
    const isCompleted = nextRecognition >= MAX_RECOGNITION_COUNT;

    const result = applyLearnAnswer(session, wordId, familiarity, isCompleted);
    assert.ok(result, `applyLearnAnswer 不应对当前词返回 null（wordId=${wordId}）`);
    steps.push(result);
    session = result.session;
  }

  throw new Error(`会话在 ${maxSteps} 步内未结束，可能存在死循环`);
}

test('Learn 前 3 张卡展示 3 个不同的新词（bootstrap）', () => {
  const session = createLearnSession('book', 's1', wordIds('w', 10));
  const shown: string[] = [];
  let current = session;
  for (let i = 0; i < INITIAL_NEW_WORD_BOOTSTRAP_COUNT; i += 1) {
    assert.ok(current.currentWordId);
    shown.push(current.currentWordId!);
    const result = applyLearnAnswer(current, current.currentWordId!, 'fuzzy', false)!;
    current = result.session;
  }
  assert.deepEqual(shown, ['w1', 'w2', 'w3']);
  assert.equal(new Set(shown).size, 3);
});

test('新词与巩固词公平调度：不会卡在固定的 3～5 个词里循环', () => {
  const session = createLearnSession('book', 's2', wordIds('w', 40));
  // 全部回答 unknown：既不会 completed（recognitionCount 一直被重置为 0），
  // 也会让巩固任务很快变得 eligible，从而持续引入新词直到触碰上限。
  const { finalSession } = runSession(session, () => 'unknown');

  assert.ok(
    finalSession.seenWordIds.length > INITIAL_NEW_WORD_BOOTSTRAP_COUNT + MAX_CONSECUTIVE_NEW_CARDS,
    `期望展示的不同词数量明显多于一个固定小循环，实际 seenWordIds.length=${finalSession.seenWordIds.length}`,
  );
  assert.equal(finalSession.seenWordIds.length, MAX_UNIQUE_WORDS_PER_GROUP, '词量充足时应当用满 20 个不同词的上限');
});

test('unknown / fuzzy / known 分别按当前规则延后巩固任务的可展示时机', () => {
  const distanceOf: Record<Familiarity, number> = { unknown: 1, fuzzy: 2, known: 3 };

  for (const familiarity of Object.keys(distanceOf) as Familiarity[]) {
    const session = createLearnSession('book', `s-${familiarity}`, wordIds('w', 5));
    const totalBefore = session.totalPresentationCount;
    const result = applyLearnAnswer(session, session.currentWordId!, familiarity, false)!;
    const task = result.session.reinforcementQueue.find((t) => t.wordId === session.currentWordId);
    assert.ok(task, `${familiarity} 应该生成一个巩固任务`);
    assert.equal(
      task!.eligibleAfterPresentationCount,
      totalBefore + distanceOf[familiarity],
      `${familiarity} 的延后距离应为 ${distanceOf[familiarity]}`,
    );
  }
});

test('一个词连续 3 次 known 后 completed，并永久退出本组', () => {
  const session = createLearnSession('book', 's3', ['only']);
  let current = session;
  let lastResult: LearnAnswerResult | undefined;

  for (let i = 0; i < 3; i += 1) {
    assert.equal(current.currentWordId, 'only', `第 ${i + 1} 次回答前应仍是 only`);
    lastResult = applyLearnAnswer(current, 'only', 'known', i === 2)!;
    assert.ok(lastResult);
    current = lastResult.session;
  }

  assert.equal(lastResult!.outcome, 'completed');
  assert.deepEqual(current.completedWordIds, ['only']);
  assert.equal(current.currentWordId, undefined, 'completed 后本组应立即结束（唯一词已完成）');
  assert.equal(current.endReason, 'book-exhausted');

  // 永久退出：即使再次尝试对它判定，也会被拒绝（会话已结束）。
  assert.equal(applyLearnAnswer(current, 'only', 'known', true), null);
});

test('完成第 10 个词后立即结束，不会再展示第 11 个目标词', () => {
  const session = createLearnSession('book', 's4', wordIds('w', 25));
  const { steps } = runSession(session, () => 'known');

  const completedSteps = steps.filter((s) => s.outcome === 'completed');
  assert.equal(completedSteps.length, LEARN_TARGET_COMPLETED, '应当恰好完成 10 个词');

  const tenthCompletionIndex = steps.findIndex((s) => s.session.completedWordIds.length === LEARN_TARGET_COMPLETED);
  assert.notEqual(tenthCompletionIndex, -1);
  const tenthStep = steps[tenthCompletionIndex];
  assert.equal(tenthStep.session.endReason, 'completed-target');
  assert.equal(tenthStep.session.currentWordId, undefined, '达到目标的同一步就应结束，不再产生下一张卡');
  assert.equal(tenthCompletionIndex, steps.length - 1, '达到目标后不应再有后续步骤/卡片');
});

test('每组最多展示 20 个不同词：carryover 占满全部名额时不会引入任何新词', () => {
  const carryover = wordIds('c', MAX_UNIQUE_WORDS_PER_GROUP);
  const freshWords = wordIds('n', 10);
  const session = createLearnSession('book', 's5', freshWords, carryover);

  const { finalSession, steps } = runSession(session, () => 'unknown');

  const everShown = new Set<string>();
  let s = session;
  everShown.add(s.currentWordId!);
  for (const step of steps) {
    if (step.session.currentWordId) everShown.add(step.session.currentWordId);
  }

  for (const freshId of freshWords) {
    assert.ok(!everShown.has(freshId), `carryover 占满 20 个名额时，新词 ${freshId} 不应被展示`);
  }
  assert.deepEqual(finalSession.pendingWordIds, freshWords, '未被引入的新词应原封不动地留在 pendingWordIds 中');
});

test('每组最多展示 20 个不同词：seenWordIds 在整个过程中从不超过上限', () => {
  const carryover = wordIds('c', 15);
  const freshWords = wordIds('n', 30);
  const session = createLearnSession('book', 's6', freshWords, carryover);

  let current = session;
  assert.ok(current.seenWordIds.length <= MAX_UNIQUE_WORDS_PER_GROUP);
  for (let i = 0; i < 500 && current.currentWordId; i += 1) {
    const wordId = current.currentWordId;
    const result = applyLearnAnswer(current, wordId, 'unknown', false)!;
    current = result.session;
    assert.ok(
      current.seenWordIds.length <= MAX_UNIQUE_WORDS_PER_GROUP,
      `第 ${i + 1} 步后 seenWordIds.length=${current.seenWordIds.length} 超过上限 ${MAX_UNIQUE_WORDS_PER_GROUP}`,
    );
  }
});

test('总展示次数达到 75 后立即结束，不产生第 76 张卡', () => {
  const session = createLearnSession('book', 's7', wordIds('w', 50));
  const { finalSession, steps } = runSession(session, () => 'unknown');

  assert.equal(finalSession.totalPresentationCount, MAX_TOTAL_PRESENTATIONS_PER_GROUP);
  assert.equal(finalSession.endReason, 'paused-presentation-cap');
  assert.equal(finalSession.currentWordId, undefined);
  // 最后一步本身就是让计数刚好达到上限的那一步，之后不再有任何后续步骤。
  assert.equal(steps[steps.length - 1].session.totalPresentationCount, MAX_TOTAL_PRESENTATIONS_PER_GROUP);
});

test('单词展示满 5 次仍未掌握时转入 Review（graduated）', () => {
  const session = createLearnSession('book', 's8', ['only']);
  let current = session;
  let lastResult: LearnAnswerResult | undefined;

  for (let i = 0; i < MAX_PRESENTATIONS_PER_WORD; i += 1) {
    assert.equal(current.currentWordId, 'only');
    lastResult = applyLearnAnswer(current, 'only', 'unknown', false)!;
    current = lastResult.session;
  }

  assert.equal(lastResult!.outcome, 'graduated');
  assert.deepEqual(current.graduatedWordIds, ['only']);
  assert.equal(current.completedWordIds.length, 0);
});

test('展示未满 5 次的未掌握词，在本组结束时会作为 carryover 进入下一组，不会消失', () => {
  // 提供充足的词量，全部回答 unknown，让总展示次数撞到 75 的上限而结束——
  // 这样必然有词还停留在“已展示但未解决”的巩固队列里，且尚未达到每词 5 次的上限。
  const session = createLearnSession('book', 's9', wordIds('w', 50));
  const { finalSession } = runSession(session, () => 'unknown');

  assert.equal(finalSession.endReason, 'paused-presentation-cap');
  assert.ok(finalSession.carryoverWordIds.length > 0, '结束时应有未解决的词被移入 carryoverWordIds');

  const underFiveCarryover = finalSession.carryoverWordIds.filter(
    (id) => (finalSession.presentationCounts[id] ?? 0) < MAX_PRESENTATIONS_PER_WORD,
  );
  assert.ok(underFiveCarryover.length > 0, '至少应有一个 carryover 词的展示次数未满 5 次，证明它不会因为“未完成”而消失');

  for (const id of finalSession.carryoverWordIds) {
    assert.ok(!finalSession.completedWordIds.includes(id), 'carryover 词不应同时是 completed');
    assert.ok(!finalSession.graduatedWordIds.includes(id), 'carryover 词不应同时是 graduated');
  }
});

test('carryover 超过 20 个时，未被接纳的部分既不丢失也不被错误改写', () => {
  const carryover = wordIds('c', 25); // 超出 MAX_UNIQUE_WORDS_PER_GROUP(20) 5 个
  const overflow = carryover.slice(20);
  const accepted = carryover.slice(0, 20);

  const session = createLearnSession('book', 's10', [], carryover);

  // 创建时立即可见：溢出的 5 个词哪里都不该出现。
  const referencedAtCreation = new Set<string>([
    ...session.pendingWordIds,
    ...session.reinforcementQueue.map((t) => t.wordId),
    ...session.seenWordIds,
    ...(session.currentWordId ? [session.currentWordId] : []),
  ]);
  for (const id of overflow) {
    assert.ok(!referencedAtCreation.has(id), `溢出词 ${id} 不应出现在新建会话的任何字段中`);
  }
  for (const id of accepted) {
    // 至少应该被会话记住（要么已展示，要么仍在队列里）。
    const known =
      session.pendingWordIds.includes(id) ||
      session.reinforcementQueue.some((t) => t.wordId === id) ||
      session.seenWordIds.includes(id) ||
      session.currentWordId === id;
    assert.ok(known, `被接纳的 carryover 词 ${id} 应该出现在会话状态中`);
  }

  // 跑完整组之后，溢出的 5 个词依然从未被展示或提及过。
  const { finalSession, steps } = runSession(session, () => 'unknown');
  const everReferenced = new Set<string>(referencedAtCreation);
  for (const step of steps) {
    if (step.session.currentWordId) everReferenced.add(step.session.currentWordId);
    for (const t of step.session.reinforcementQueue) everReferenced.add(t.wordId);
  }
  for (const id of overflow) {
    assert.ok(!everReferenced.has(id), `溢出词 ${id} 全程都不应被本组引用`);
    assert.ok(!finalSession.carryoverWordIds.includes(id), '溢出词不应被写入 carryoverWordIds（它们从未属于本组）');
    assert.ok(!finalSession.completedWordIds.includes(id));
    assert.ok(!finalSession.graduatedWordIds.includes(id));
  }
});
