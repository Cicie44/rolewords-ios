import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { sampleVocabulary } from '@/src/data/sampleVocabulary';
import {
  fetchInterviewSessionDetail,
  generateInterviewAnswers,
  generateInterviewQuestions,
  saveInterviewQuestionNote,
} from '@/src/services/interviewService';
import {
  deleteSavedItem,
  fetchSavedItems,
  generateSavedItemChineseText,
  saveSavedItem,
} from '@/src/services/savedItemsService';
import type {
  InterviewQuestion,
  InterviewQuestionType,
  InterviewSessionSummary,
} from '@/src/types/interview';
import type { SavedItem, SavedItemType } from '@/src/types/savedItem';

const QUESTION_TYPE_LABELS: Record<InterviewQuestionType, string> = {
  behavioral: '行为类',
  technical: '技术类',
  role_specific: '岗位相关',
  general: '通用',
};

type AnswerFlowPhase = 'idle' | 'saving_notes' | 'generating_answers';

type DetailLoadState = 'loading' | 'loaded' | 'not_found' | 'error';

type SavedLoadState = 'loading' | 'loaded' | 'error';

// `key` is only ever used for in-page busy/error state, never sent to Supabase.
type InterviewBookmarkTarget = {
  key: string;
  content: string;
  questionId: string;
};

// A single, page-wide "currently selected piece of one answer" — replaced
// whenever the user makes a new selection in any question's answer, and
// cleared on cancel or successful save. `context` is computed once at
// selection time from that question's own generatedAnswer only — never the
// CV, job description, user notes, or any other question's answer.
type AnswerSelection = {
  questionId: string;
  start: number;
  end: number;
  content: string;
  context?: string;
};

type FragmentSavePhase = 'idle' | 'generating_chinese' | 'saving';

// Drives both the button label and whether tapping it should call
// generateSavedItemChineseText/saveSavedItem at all.
type FragmentSaveCategory = 'new' | 'needs_chinese' | 'saved';

const FRAGMENT_SAVE_BUTTON_LABELS: Record<FragmentSaveCategory, string> = {
  new: '收藏选中内容',
  needs_chinese: '补充中文',
  saved: '已收藏',
};

// Built once at module load, not on every render or tap — a read-only
// case-insensitive lookup from a vocabulary term to its Chinese meaning.
// Keyed by the term's trimmed, en-US-lowercased form so "Stakeholder" and
// "stakeholder" both hit the same entry, but "stakeholder." or "key
// stakeholder" (different full strings) correctly miss.
const localVocabularyChineseMeaningByTerm = new Map<string, string>(
  sampleVocabulary
    .map((item): [string, string] => [
      item.term.trim().toLocaleLowerCase('en-US'),
      item.chineseMeaning.trim(),
    ])
    .filter(([term, meaning]) => term.length > 0 && meaning.length > 0),
);

// Returns undefined (never an empty string) when there's no exact local
// match, so callers can fall back to generateSavedItemChineseText.
function findLocalChineseMeaning(trimmedContent: string): string | undefined {
  return localVocabularyChineseMeaningByTerm.get(trimmedContent.toLocaleLowerCase('en-US'));
}

// v0.1 lightweight context extraction — not an NLP sentence tokenizer. Uses
// '.', '?', '!', and newlines as lightweight sentence boundaries to find the
// sentence surrounding [start, end) within `fullText` (which is always just
// that one question's own generatedAnswer). If the resulting sentence is
// longer than 1000 characters, crops around the selection itself rather than
// just truncating from the sentence's start, so the selected text stays
// inside the returned context whenever possible.
const CONTEXT_SENTENCE_BOUNDARY = /[.?!\n]/;
const MAX_SELECTION_CONTEXT_LENGTH = 1000;

function extractSelectionContext(fullText: string, start: number, end: number): string | undefined {
  if (fullText.length === 0 || start < 0 || end > fullText.length || start >= end) {
    return undefined;
  }

  let sentenceStart = 0;
  for (let i = start - 1; i >= 0; i -= 1) {
    if (CONTEXT_SENTENCE_BOUNDARY.test(fullText[i])) {
      sentenceStart = i + 1;
      break;
    }
  }

  let sentenceEnd = fullText.length;
  for (let i = end; i < fullText.length; i += 1) {
    if (CONTEXT_SENTENCE_BOUNDARY.test(fullText[i])) {
      sentenceEnd = i + 1; // Keep the boundary punctuation itself.
      break;
    }
  }

  let context = fullText.slice(sentenceStart, sentenceEnd).trim();

  if (context.length > MAX_SELECTION_CONTEXT_LENGTH) {
    const selectionStartInContext = Math.max(0, start - sentenceStart);
    const selectionEndInContext = Math.min(context.length, end - sentenceStart);
    const selectionLength = Math.max(0, selectionEndInContext - selectionStartInContext);

    if (selectionLength >= MAX_SELECTION_CONTEXT_LENGTH) {
      context = context.slice(selectionStartInContext, selectionStartInContext + MAX_SELECTION_CONTEXT_LENGTH);
    } else {
      const remaining = MAX_SELECTION_CONTEXT_LENGTH - selectionLength;
      const before = Math.floor(remaining / 2);
      const after = remaining - before;
      const cropStart = Math.max(0, selectionStartInContext - before);
      const cropEnd = Math.min(context.length, selectionEndInContext + after);
      context = context.slice(cropStart, cropEnd);
    }

    context = context.trim();
  }

  return context.length > 0 ? context : undefined;
}

// A stable key for the in-memory Chinese-text cache, distinguishing both the
// question and the exact trimmed content — never a loosely-joined string
// that different inputs could collide on.
function buildSelectionKey(questionId: string, trimmedContent: string): string {
  return JSON.stringify([questionId, trimmedContent]);
}

function hasGeneratedAnswer(question: InterviewQuestion): boolean {
  return typeof question.generatedAnswer === 'string' && question.generatedAnswer.trim().length > 0;
}

// Quote/bracket characters (English and Chinese) that might trail the actual
// sentence-ending punctuation, e.g. a quoted sentence ending in ." or ）.
const TRAILING_WRAPPER_CHARS = /["'“”‘’「」『』()\[\]（）【】]+$/;

function inferSavedItemType(content: string): SavedItemType {
  const trimmed = content.trim();
  const withoutTrailingWrappers = trimmed.replace(TRAILING_WRAPPER_CHARS, '');

  if (/[.?!]$/.test(withoutTrailingWrappers)) {
    return 'sentence';
  }

  if (/\s/.test(trimmed)) {
    return 'phrase';
  }

  return 'word';
}

// Exactly 10 questions, and after sorting by questionOrder the sequence is
// strictly 1,2,3...10 — no duplicates, no gaps.
function isCompleteQuestionSet(questions: InterviewQuestion[]): boolean {
  if (questions.length !== 10) {
    return false;
  }
  const sorted = [...questions].sort((a, b) => a.questionOrder - b.questionOrder);
  return sorted.every((question, index) => question.questionOrder === index + 1);
}

function InterviewQuestionCard({
  question,
  index,
  note,
  isSaving,
  saveError,
  disabled,
  onChangeNote,
  onSaveNote,
  isQuestionSaved,
  questionBookmarkBusy,
  bookmarksDisabled,
  questionBookmarkError,
  onToggleQuestionBookmark,
  onAnswerSelectionChange,
  fragmentSelectionContent,
  fragmentSaveCategory,
  fragmentSaveDisabled,
  fragmentCancelDisabled,
  fragmentSavePhase,
  fragmentError,
  onSaveFragment,
  onCancelFragment,
}: {
  question: InterviewQuestion;
  index: number;
  note: string;
  isSaving: boolean;
  saveError: string | null;
  disabled: boolean;
  onChangeNote: (text: string) => void;
  onSaveNote: () => void;
  isQuestionSaved: boolean;
  questionBookmarkBusy: boolean;
  bookmarksDisabled: boolean;
  questionBookmarkError: string | null;
  onToggleQuestionBookmark: () => void;
  onAnswerSelectionChange: (start: number, end: number) => void;
  fragmentSelectionContent: string | null;
  fragmentSaveCategory: FragmentSaveCategory;
  fragmentSaveDisabled: boolean;
  fragmentCancelDisabled: boolean;
  fragmentSavePhase: FragmentSavePhase;
  fragmentError: string | null;
  onSaveFragment: () => void;
  onCancelFragment: () => void;
}) {
  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeaderRow}>
        <Text style={styles.questionIndex}>问题 {index + 1}</Text>
        <View style={styles.questionHeaderRight}>
          <Text style={styles.questionTypeLabel}>{QUESTION_TYPE_LABELS[question.questionType]}</Text>
          <Pressable
            onPress={onToggleQuestionBookmark}
            disabled={bookmarksDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              isQuestionSaved ? `取消收藏问题 ${index + 1}` : `收藏问题 ${index + 1}`
            }
            style={[styles.bookmarkButton, bookmarksDisabled && styles.bookmarkButtonDisabled]}>
            {questionBookmarkBusy ? (
              <ActivityIndicator size="small" color="#2f95dc" />
            ) : (
              <SymbolView
                name={{
                  ios: isQuestionSaved ? 'bookmark.fill' : 'bookmark',
                  android: isQuestionSaved ? 'bookmark' : 'bookmark_border',
                  web: isQuestionSaved ? 'bookmark' : 'bookmark_border',
                }}
                tintColor="#2f95dc"
                size={20}
              />
            )}
          </Pressable>
        </View>
      </View>
      <Text style={styles.questionText}>{question.questionText}</Text>
      {questionBookmarkError && <Text style={styles.errorText}>{questionBookmarkError}</Text>}

      <Text style={styles.noteLabel}>你的经历或回答要点（可选）</Text>
      <TextInput
        value={note}
        onChangeText={onChangeNote}
        onBlur={onSaveNote}
        editable={!disabled && !isSaving}
        multiline
        textAlignVertical="top"
        placeholder="可以补充相关项目、经历或想强调的内容"
        placeholderTextColor="#999"
        accessibilityLabel={`问题 ${index + 1} 的回答要点`}
        style={[styles.noteInput, (disabled || isSaving) && styles.noteInputDisabled]}
      />

      {isSaving && <Text style={styles.savingText}>正在保存…</Text>}

      {saveError && (
        <View style={styles.saveErrorRow}>
          <Text style={styles.errorText}>{saveError}</Text>
          <Pressable
            onPress={onSaveNote}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`重试保存问题 ${index + 1} 的回答要点`}
            hitSlop={8}
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      )}

      {hasGeneratedAnswer(question) && (
        <>
          <Text style={styles.answerLabel}>参考答案</Text>
          <TextInput
            value={question.generatedAnswer ?? ''}
            editable={false}
            multiline
            scrollEnabled={false}
            contextMenuHidden={false}
            selectionColor="#2f95dc"
            onSelectionChange={(event) => {
              const { start, end } = event.nativeEvent.selection;
              onAnswerSelectionChange(start, end);
            }}
            accessibilityLabel={`问题 ${index + 1} 的参考答案，长按可选择文字`}
            style={styles.answerText}
          />

          {fragmentSelectionContent && (
            <View style={styles.fragmentSelectionBox}>
              <Text style={styles.fragmentSelectionLabel}>已选择</Text>
              <Text style={styles.fragmentSelectionPreview} numberOfLines={2} ellipsizeMode="tail">
                {fragmentSelectionContent}
              </Text>

              {fragmentError && <Text style={styles.errorText}>{fragmentError}</Text>}

              <View style={styles.fragmentActionsRow}>
                <Pressable
                  onPress={onCancelFragment}
                  disabled={fragmentCancelDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="取消选择"
                  hitSlop={8}
                  style={styles.fragmentCancelButton}>
                  <Text style={styles.fragmentCancelButtonText}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={onSaveFragment}
                  disabled={fragmentSaveDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={FRAGMENT_SAVE_BUTTON_LABELS[fragmentSaveCategory]}
                  style={[
                    styles.fragmentSaveButton,
                    fragmentSaveDisabled && styles.generateButtonDisabled,
                  ]}>
                  {fragmentSavePhase === 'generating_chinese' ? (
                    <View style={styles.fragmentSaveButtonRow}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.fragmentSaveButtonText}>正在生成中文…</Text>
                    </View>
                  ) : fragmentSavePhase === 'saving' ? (
                    <View style={styles.fragmentSaveButtonRow}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.fragmentSaveButtonText}>正在收藏…</Text>
                    </View>
                  ) : (
                    <Text style={styles.fragmentSaveButtonText}>
                      {FRAGMENT_SAVE_BUTTON_LABELS[fragmentSaveCategory]}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function InterviewSessionScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    jobTitle?: string | string[];
    companyName?: string | string[];
  }>();

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = (rawId ?? '').trim();
  const jobTitle = Array.isArray(params.jobTitle) ? params.jobTitle[0] : params.jobTitle;
  const companyName = Array.isArray(params.companyName)
    ? params.companyName[0]
    : params.companyName;

  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const generatingRef = useRef(false);

  // Per-question answer-notes state, lifted up from the card so the "generate
  // answers" flow can save every question's notes before calling the answers
  // Function. The *Ref mirrors are updated synchronously (not via an effect)
  // so async handlers always read the latest value, never a stale closure.
  const [notesByQuestionId, setNotesByQuestionId] = useState<Record<string, string>>({});
  const [savedNotesByQuestionId, setSavedNotesByQuestionId] = useState<Record<string, string>>({});
  const [saveErrorsByQuestionId, setSaveErrorsByQuestionId] = useState<Record<string, string>>({});
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<string>>(new Set());

  const notesByQuestionIdRef = useRef<Record<string, string>>({});
  const savedNotesByQuestionIdRef = useRef<Record<string, string>>({});
  // Caches the in-flight save Promise per question so a TextInput's onBlur
  // and the batch save before answer generation never issue two concurrent
  // updates for the same question.
  const savePromisesByQuestionIdRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const [answerFlowPhase, setAnswerFlowPhase] = useState<AnswerFlowPhase>('idle');
  const [answerFlowError, setAnswerFlowError] = useState<string | null>(null);
  const answerFlowRef = useRef(false);

  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>('loading');
  const [loadedSession, setLoadedSession] = useState<InterviewSessionSummary | null>(null);
  const [detailRetryToken, setDetailRetryToken] = useState(0);
  const [hasInconsistentQuestionData, setHasInconsistentQuestionData] = useState(false);

  // Bookmark state for whole-question / whole-answer "整段收藏". Loaded and
  // retried entirely independently of the interview detail above — a failure
  // here must never block questions, notes, or generated answers.
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [savedLoadState, setSavedLoadState] = useState<SavedLoadState>('loading');
  const [savedRetryToken, setSavedRetryToken] = useState(0);
  const [bookmarkBusyKey, setBookmarkBusyKey] = useState<string | null>(null);
  const [bookmarkErrorsByKey, setBookmarkErrorsByKey] = useState<Record<string, string>>({});
  const bookmarkBusyKeyRef = useRef<string | null>(null);

  // The one currently-selected piece of an answer (in-page only — never
  // written to Supabase until the user taps "收藏选中内容"). Network state
  // (fragmentSavePhase/fragmentSavingRef) lives here in the parent, never in
  // the card. `answerSelectionRef` mirrors the state synchronously so a
  // completing save can tell whether the selection it was saving is still
  // the live one before clearing it.
  const [answerSelection, setAnswerSelection] = useState<AnswerSelection | null>(null);
  const answerSelectionRef = useRef<AnswerSelection | null>(null);
  const [fragmentError, setFragmentError] = useState<string | null>(null);
  const [fragmentSavePhase, setFragmentSavePhase] = useState<FragmentSavePhase>('idle');
  const fragmentSavingRef = useRef(false);
  // Bumped whenever the displayed record changes (id switch, detail reload,
  // unmount) so a fragment save already in flight can detect it's now stale
  // and avoid clearing/overwriting the new record's selection state.
  const fragmentSaveTokenRef = useRef(0);
  // In-memory only (never written to any database) cache of the most
  // recently generated/matched Chinese text for one selectionKey, so a
  // saveSavedItem failure after a successful (possibly paid) AI call never
  // forces a second AI call on retry.
  const chineseTextCacheRef = useRef<{ selectionKey: string; chineseText: string } | null>(null);

  // Deliberately has no dependency on `questions` or any note state — it
  // only ever reads its `nextQuestions` argument and stable setter/ref
  // identities, so it's safe to list in the detail-loading effect's
  // dependency array without ever causing that effect to loop.
  const applyQuestions = useCallback((nextQuestions: InterviewQuestion[]) => {
    const sorted = [...nextQuestions].sort((a, b) => a.questionOrder - b.questionOrder);

    const notes: Record<string, string> = {};
    for (const question of sorted) {
      notes[question.id] = question.userNotes ?? '';
    }

    notesByQuestionIdRef.current = notes;
    savedNotesByQuestionIdRef.current = { ...notes };

    setQuestions(sorted);
    setNotesByQuestionId(notes);
    setSavedNotesByQuestionId({ ...notes });
    setSaveErrorsByQuestionId({});
    setSavingQuestionIds(new Set());
  }, []);

  // Resets everything tied to "which record is currently displayed" so a
  // new detail load (a different retry, e.g.) never briefly shows the
  // previous record's questions/answers before the fresh data arrives.
  const clearPageState = () => {
    setQuestions(null);
    setLoadedSession(null);
    setHasInconsistentQuestionData(false);
    setErrorMessage(null);
    setAnswerFlowError(null);
    setNotesByQuestionId({});
    setSavedNotesByQuestionId({});
    setSaveErrorsByQuestionId({});
    setSavingQuestionIds(new Set());
    notesByQuestionIdRef.current = {};
    savedNotesByQuestionIdRef.current = {};

    // A new record load (different id, or a retry) must never leave a
    // selection/save state hanging around from the previous interview's
    // question/answer. Bumping the token also invalidates any fragment save
    // still in flight for the old record.
    fragmentSaveTokenRef.current += 1;
    fragmentSavingRef.current = false;
    setFragmentSavePhase('idle');
    chineseTextCacheRef.current = null;
    answerSelectionRef.current = null;
    setAnswerSelection(null);
    setFragmentError(null);
  };

  useEffect(() => {
    if (id.length === 0) {
      return;
    }

    let isCancelled = false;

    clearPageState();
    setDetailLoadState('loading');

    fetchInterviewSessionDetail(id)
      .then((detail) => {
        if (isCancelled) {
          return;
        }

        if (!detail) {
          setDetailLoadState('not_found');
          return;
        }

        setLoadedSession(detail.session);

        if (detail.questions.length === 0) {
          // Nothing generated yet — a normal, expected state. Leave
          // `questions` as null so the existing "generate questions" intro
          // card renders.
          setHasInconsistentQuestionData(false);
          setDetailLoadState('loaded');
          return;
        }

        if (isCompleteQuestionSet(detail.questions)) {
          setHasInconsistentQuestionData(false);
          applyQuestions(detail.questions);
          setDetailLoadState('loaded');
          return;
        }

        // 1-9 questions, more than 10, or a non-sequential questionOrder —
        // never partially render this or try to fix/complete it here.
        setHasInconsistentQuestionData(true);
        setDetailLoadState('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }
        setDetailLoadState('error');
      });

    return () => {
      isCancelled = true;
    };
  }, [id, detailRetryToken, applyQuestions]);

  // Invalidates any in-flight fragment save on unmount, mirroring what
  // clearPageState already does for an id switch or a detail reload.
  useEffect(() => {
    return () => {
      fragmentSaveTokenRef.current += 1;
      fragmentSavingRef.current = false;
      chineseTextCacheRef.current = null;
    };
  }, []);

  // Keyed by trimmed content (matching the saved_items unique(user_id,
  // content) constraint) rather than by question id, since one question's
  // question-text and generated-answer are two distinct bookmarkable
  // contents sharing the same questionId.
  const savedItemByContent = useMemo(() => {
    const map = new Map<string, SavedItem>();
    for (const item of savedItems) {
      map.set(item.content.trim(), item);
    }
    return map;
  }, [savedItems]);

  // A primitive boolean (rather than `questions` itself) so this only
  // recomputes the loadSavedItems callback identity when completeness
  // actually flips, not on every note-save's new `questions` array reference.
  const questionsReady = questions !== null && isCompleteQuestionSet(questions);

  const loadSavedItems = useCallback(() => {
    if (id.length === 0 || detailLoadState !== 'loaded' || !questionsReady) {
      return undefined;
    }

    let isActive = true;
    setSavedLoadState('loading');

    fetchSavedItems()
      .then((items) => {
        if (!isActive) {
          return;
        }
        setSavedItems(items);
        setSavedLoadState('loaded');
        setBookmarkErrorsByKey({});
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setSavedLoadState('error');
      });

    return () => {
      isActive = false;
    };
  }, [id, detailLoadState, questionsReady, savedRetryToken]);

  useFocusEffect(loadSavedItems);

  const handleToggleInterviewBookmark = async (target: InterviewBookmarkTarget) => {
    if (savedLoadState !== 'loaded') {
      return;
    }
    if (bookmarkBusyKeyRef.current !== null) {
      return;
    }
    const trimmedContent = target.content.trim();
    if (trimmedContent.length === 0) {
      return;
    }

    bookmarkBusyKeyRef.current = target.key;
    setBookmarkBusyKey(target.key);
    setBookmarkErrorsByKey((prev) => {
      if (!(target.key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[target.key];
      return next;
    });

    const existing = savedItemByContent.get(trimmedContent);

    try {
      if (existing) {
        await deleteSavedItem(existing.id);
        setSavedItems((prev) => prev.filter((item) => item.id !== existing.id));
      } else {
        const saved = await saveSavedItem({
          itemType: 'sentence',
          content: target.content,
          sourceType: 'interview',
          sourceId: target.questionId,
        });
        setSavedItems((prev) => [
          saved,
          ...prev.filter(
            (item) => item.id !== saved.id && item.content.trim() !== saved.content.trim(),
          ),
        ]);
      }
    } catch {
      setBookmarkErrorsByKey((prev) => ({
        ...prev,
        [target.key]: existing
          ? '取消收藏失败，请检查网络后重试。'
          : '收藏失败，请检查网络后重试。',
      }));
    } finally {
      bookmarkBusyKeyRef.current = null;
      setBookmarkBusyKey(null);
    }
  };

  // Ignores collapsed selections (start === end) entirely — this is exactly
  // what happens when the handles collapse from tapping the "收藏选中内容"
  // button itself, and silently ignoring it (rather than clearing) is what
  // keeps that tap from wiping out the selection it's meant to act on.
  const handleAnswerSelectionChange = (
    questionId: string,
    start: number,
    end: number,
    fullText: string,
  ) => {
    // A save is in flight — its target selection must stay exactly what it
    // was when the request started, so a new long-press elsewhere while
    // waiting on the network must not replace it.
    if (fragmentSavingRef.current) {
      return;
    }
    if (start === end) {
      return;
    }

    const content = fullText.slice(start, end);
    if (content.trim().length === 0) {
      return;
    }

    const context = extractSelectionContext(fullText, start, end);
    const selection: AnswerSelection = { questionId, start, end, content, context };
    answerSelectionRef.current = selection;
    setAnswerSelection(selection);
    setFragmentError(null);
    // A genuinely new selection invalidates any cached Chinese text — it was
    // generated/matched for a different piece of content.
    chineseTextCacheRef.current = null;
  };

  const handleCancelFragmentSelection = () => {
    if (fragmentSavingRef.current) {
      return;
    }
    answerSelectionRef.current = null;
    setAnswerSelection(null);
    setFragmentError(null);
    chineseTextCacheRef.current = null;
  };

  const handleSaveFragment = async () => {
    if (fragmentSavingRef.current) {
      return;
    }
    if (bookmarkBusyKeyRef.current !== null) {
      return;
    }
    if (!answerSelection) {
      return;
    }

    const trimmedContent = answerSelection.content.trim();
    if (trimmedContent.length === 0) {
      return;
    }
    if (savedLoadState !== 'loaded') {
      setFragmentError('收藏状态尚未加载，请稍后重试。');
      return;
    }

    const existing = savedItemByContent.get(trimmedContent);
    const existingChineseText = existing?.chineseText?.trim() ?? '';
    if (existing && existingChineseText.length > 0) {
      // Already bookmarked with non-empty Chinese text — nothing to do.
      return;
    }

    const requestToken = fragmentSaveTokenRef.current;
    const requestQuestionId = answerSelection.questionId;
    const selectionContext = answerSelection.context;
    const selectionKey = buildSelectionKey(requestQuestionId, trimmedContent);
    // Preserve the existing record's itemType (and, below, sourceType/
    // sourceId) when this is a "supply missing Chinese" save — only a
    // brand-new bookmark gets a freshly inferred itemType.
    const itemTypeForRequest = existing ? existing.itemType : inferSavedItemType(trimmedContent);

    const isSameSelectionStillActive = () => {
      const current = answerSelectionRef.current;
      return (
        current !== null &&
        current.questionId === requestQuestionId &&
        current.content.trim() === trimmedContent
      );
    };

    fragmentSavingRef.current = true;
    setFragmentError(null);

    try {
      let chineseText: string;
      const cached = chineseTextCacheRef.current;

      if (cached && cached.selectionKey === selectionKey) {
        // A prior attempt for this exact question+content already produced
        // Chinese text (and then failed to save) — reuse it instead of
        // calling the AI Function (or matching locally) again.
        chineseText = cached.chineseText;
      } else {
        setFragmentSavePhase('generating_chinese');

        const localMeaning = findLocalChineseMeaning(trimmedContent);

        if (localMeaning) {
          // A full local match — no Function call, no AI cost.
          chineseText = localMeaning;
        } else {
          try {
            chineseText = await generateSavedItemChineseText({
              content: trimmedContent,
              itemType: itemTypeForRequest,
              context: selectionContext,
            });
          } catch {
            if (fragmentSaveTokenRef.current === requestToken && isSameSelectionStillActive()) {
              setFragmentError('中文释义生成失败，请检查网络后重试。');
            }
            return;
          }
        }

        if (fragmentSaveTokenRef.current !== requestToken) {
          // The displayed record changed while this request was in flight —
          // this stale result must not be written into the new record's cache.
          return;
        }

        chineseTextCacheRef.current = { selectionKey, chineseText };
      }

      if (fragmentSaveTokenRef.current !== requestToken) {
        return;
      }

      setFragmentSavePhase('saving');

      const saved = await saveSavedItem({
        itemType: itemTypeForRequest,
        content: trimmedContent,
        chineseText,
        sourceType: existing ? existing.sourceType : 'interview',
        sourceId: existing ? existing.sourceId : requestQuestionId,
      });

      if (fragmentSaveTokenRef.current !== requestToken) {
        // The displayed record changed (different id, a reload, or unmount)
        // while this request was in flight. The bookmark was saved
        // server-side, but this stale completion must not touch whatever
        // selection/local state the new record is now showing.
        return;
      }

      setSavedItems((prev) => [
        saved,
        ...prev.filter(
          (item) => item.id !== saved.id && item.content.trim() !== saved.content.trim(),
        ),
      ]);

      chineseTextCacheRef.current = null;

      // Only clear the selection if it's still exactly the one just saved —
      // the user may have already selected something else while this request
      // was in flight, and that newer selection must not be clobbered.
      if (isSameSelectionStillActive()) {
        answerSelectionRef.current = null;
        setAnswerSelection(null);
      }
      setFragmentError(null);
    } catch {
      // Only reaches here on a saveSavedItem failure — the Chinese-generation
      // try/catch above already returned before this point. The selection
      // and the Chinese-text cache are deliberately left untouched so a
      // retry can reuse the already-generated text instead of paying for it
      // again.
      if (fragmentSaveTokenRef.current === requestToken && isSameSelectionStillActive()) {
        setFragmentError('收藏失败，请检查网络后重试。');
      }
    } finally {
      // clearPageState bumps the token and already reset these for a new
      // record — a late-arriving old request must not undo that reset.
      if (fragmentSaveTokenRef.current === requestToken) {
        fragmentSavingRef.current = false;
        setFragmentSavePhase('idle');
      }
    }
  };

  const handleChangeNote = (questionId: string, text: string) => {
    notesByQuestionIdRef.current = { ...notesByQuestionIdRef.current, [questionId]: text };
    setNotesByQuestionId((prev) => ({ ...prev, [questionId]: text }));
    setSaveErrorsByQuestionId((prev) => {
      if (!(questionId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const saveQuestionNote = (questionId: string): Promise<boolean> => {
    const existingPromise = savePromisesByQuestionIdRef.current.get(questionId);
    if (existingPromise) {
      return existingPromise;
    }

    const run = async (): Promise<boolean> => {
      const latestNote = notesByQuestionIdRef.current[questionId] ?? '';
      const trimmedNote = latestNote.trim();
      const savedNote = savedNotesByQuestionIdRef.current[questionId] ?? '';

      if (trimmedNote === savedNote) {
        return true;
      }

      setSavingQuestionIds((prev) => {
        const next = new Set(prev);
        next.add(questionId);
        return next;
      });
      setSaveErrorsByQuestionId((prev) => {
        if (!(questionId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[questionId];
        return next;
      });

      try {
        const updated = await saveInterviewQuestionNote({
          interviewSessionId: id,
          questionId,
          userNotes: latestNote,
        });

        const savedValue = updated.userNotes ?? '';

        notesByQuestionIdRef.current = {
          ...notesByQuestionIdRef.current,
          [questionId]: savedValue,
        };
        savedNotesByQuestionIdRef.current = {
          ...savedNotesByQuestionIdRef.current,
          [questionId]: savedValue,
        };
        setNotesByQuestionId((prev) => ({ ...prev, [questionId]: savedValue }));
        setSavedNotesByQuestionId((prev) => ({ ...prev, [questionId]: savedValue }));
        setQuestions((prev) =>
          prev
            ? prev.map((question) =>
                question.id === questionId
                  ? { ...question, userNotes: savedValue, updatedAt: updated.updatedAt }
                  : question,
              )
            : prev,
        );

        return true;
      } catch {
        setSaveErrorsByQuestionId((prev) => ({ ...prev, [questionId]: '保存失败，请重试。' }));
        return false;
      } finally {
        setSavingQuestionIds((prev) => {
          if (!prev.has(questionId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
      }
    };

    // .finally() only ever runs its callback as a deferred microtask once
    // `run()` settles, so by the time it executes, `promise` below is always
    // already assigned — this avoids ever deleting a newer Promise that a
    // later call may have already registered for this same question.
    const promise = run().finally(() => {
      if (savePromisesByQuestionIdRef.current.get(questionId) === promise) {
        savePromisesByQuestionIdRef.current.delete(questionId);
      }
    });

    savePromisesByQuestionIdRef.current.set(questionId, promise);
    return promise;
  };

  const handleGenerate = async () => {
    if (generatingRef.current || id.length === 0) {
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const result = await generateInterviewQuestions(id);
      applyQuestions(result.questions);
      setHasInconsistentQuestionData(false);
    } catch {
      setErrorMessage('生成失败，请稍后重试。');
    } finally {
      setIsGenerating(false);
      generatingRef.current = false;
    }
  };

  const handleGenerateAnswers = async () => {
    if (answerFlowRef.current) {
      return;
    }
    if (id.length === 0) {
      return;
    }
    if (!questions || questions.length !== 10) {
      return;
    }

    const answeredCount = questions.filter(hasGeneratedAnswer).length;
    if (answeredCount === 10 || answeredCount > 0) {
      return;
    }

    answerFlowRef.current = true;
    setAnswerFlowPhase('saving_notes');
    setAnswerFlowError(null);
    Keyboard.dismiss();

    try {
      const saveResults = await Promise.all(
        questions.map((question) => saveQuestionNote(question.id)),
      );

      if (saveResults.some((result) => !result)) {
        setAnswerFlowError('部分回答要点保存失败，请先重试。');
        return;
      }

      const allSynced = questions.every((question) => {
        const latest = (notesByQuestionIdRef.current[question.id] ?? '').trim();
        const saved = savedNotesByQuestionIdRef.current[question.id] ?? '';
        return latest === saved;
      });

      if (!allSynced) {
        setAnswerFlowError('部分回答要点保存失败，请先重试。');
        return;
      }

      setAnswerFlowPhase('generating_answers');

      const result = await generateInterviewAnswers(id);
      applyQuestions(result.questions);
      setAnswerFlowError(null);
    } catch {
      setAnswerFlowError('参考答案生成失败，请稍后重试。');
    } finally {
      setAnswerFlowPhase('idle');
      answerFlowRef.current = false;
    }
  };

  if (id.length === 0) {
    return (
      <View style={styles.invalidContainer}>
        <Text style={styles.invalidText}>面试记录无效</Text>
      </View>
    );
  }

  if (detailLoadState === 'loading') {
    return (
      <View style={styles.invalidContainer}>
        <ActivityIndicator />
        <Text style={styles.invalidText}>正在加载面试记录…</Text>
      </View>
    );
  }

  if (detailLoadState === 'error') {
    return (
      <View style={styles.invalidContainer}>
        <Text style={styles.invalidText}>面试记录加载失败，请检查网络。</Text>
        <Pressable
          onPress={() => setDetailRetryToken((value) => value + 1)}
          accessibilityRole="button"
          accessibilityLabel="重试加载面试记录"
          style={styles.detailActionButton}>
          <Text style={styles.detailActionButtonText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  if (detailLoadState === 'not_found') {
    return (
      <View style={styles.invalidContainer}>
        <Text style={styles.invalidText}>该面试记录不存在或你无权访问</Text>
      </View>
    );
  }

  const displayJobTitle = loadedSession?.jobTitle ?? jobTitle;
  const displayCompanyName = loadedSession?.companyName ?? companyName;

  const answeredCount = questions ? questions.filter(hasGeneratedAnswer).length : 0;
  const isFullyAnswered = answeredCount === 10;
  const isPartiallyAnswered = answeredCount > 0 && answeredCount < 10;
  const notesLocked = isFullyAnswered || answerFlowPhase !== 'idle';

  return (
    <KeyboardAvoidingView
      style={styles.flexContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {(displayJobTitle || displayCompanyName) && (
          <Text style={styles.subtitle}>
            {displayCompanyName} · {displayJobTitle}
          </Text>
        )}

        {hasInconsistentQuestionData ? (
          <View style={styles.introCard}>
            <Text style={styles.errorText}>面试问题数据不完整，请稍后重试。</Text>
            <Pressable
              onPress={() => setDetailRetryToken((value) => value + 1)}
              accessibilityRole="button"
              accessibilityLabel="重新加载面试问题"
              style={styles.detailActionButton}>
              <Text style={styles.detailActionButtonText}>重新加载</Text>
            </Pressable>
          </View>
        ) : questions === null ? (
          <View style={styles.introCard}>
            <Text style={styles.introText}>
              AI 将根据你上传的 CV 和岗位信息生成 10 道面试问题。
            </Text>
            <Text style={styles.consentText}>
              点击生成即表示你同意本次将 CV 和岗位信息用于 AI 处理。
            </Text>

            {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

            <Pressable
              onPress={handleGenerate}
              disabled={isGenerating}
              accessibilityRole="button"
              accessibilityLabel="生成面试问题"
              style={[styles.generateButton, isGenerating && styles.generateButtonDisabled]}>
              {isGenerating ? (
                <View style={styles.generateButtonRow}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.generateButtonText}>正在生成面试问题…</Text>
                </View>
              ) : (
                <Text style={styles.generateButtonText}>生成面试问题</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <>
            {savedLoadState === 'error' && (
              <View style={styles.savedErrorBanner}>
                <Text style={styles.savedErrorBannerText}>收藏状态加载失败</Text>
                <Pressable
                  onPress={() => setSavedRetryToken((value) => value + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="重试加载收藏状态"
                  style={styles.savedErrorRetryButton}>
                  <Text style={styles.savedErrorRetryButtonText}>重试</Text>
                </Pressable>
              </View>
            )}

            {answeredCount > 0 && (
              <Text style={styles.fragmentHintText}>
                长按参考答案，可选择单词、短语或句子收藏。
              </Text>
            )}

            <View style={styles.questionsList}>
              {questions.map((question, index) => {
                const questionKey = `question:${question.id}`;
                const bookmarksDisabled = savedLoadState !== 'loaded' || bookmarkBusyKey !== null;

                const isFragmentSelected = answerSelection?.questionId === question.id;
                const trimmedSelectionContent = isFragmentSelected
                  ? answerSelection.content.trim()
                  : '';
                const existingForSelection =
                  trimmedSelectionContent.length > 0
                    ? savedItemByContent.get(trimmedSelectionContent)
                    : undefined;
                const fragmentSaveCategory: FragmentSaveCategory = !existingForSelection
                  ? 'new'
                  : (existingForSelection.chineseText?.trim().length ?? 0) > 0
                    ? 'saved'
                    : 'needs_chinese';
                const fragmentSaveDisabled =
                  fragmentSavePhase !== 'idle' ||
                  bookmarkBusyKey !== null ||
                  savedLoadState !== 'loaded' ||
                  fragmentSaveCategory === 'saved' ||
                  trimmedSelectionContent.length === 0;

                return (
                  <InterviewQuestionCard
                    key={question.id}
                    question={question}
                    index={index}
                    note={notesByQuestionId[question.id] ?? ''}
                    isSaving={savingQuestionIds.has(question.id)}
                    saveError={saveErrorsByQuestionId[question.id] ?? null}
                    disabled={notesLocked}
                    onChangeNote={(text) => handleChangeNote(question.id, text)}
                    onSaveNote={() => {
                      void saveQuestionNote(question.id);
                    }}
                    isQuestionSaved={savedItemByContent.has(question.questionText.trim())}
                    questionBookmarkBusy={bookmarkBusyKey === questionKey}
                    bookmarksDisabled={bookmarksDisabled}
                    questionBookmarkError={bookmarkErrorsByKey[questionKey] ?? null}
                    onToggleQuestionBookmark={() => {
                      void handleToggleInterviewBookmark({
                        key: questionKey,
                        content: question.questionText,
                        questionId: question.id,
                      });
                    }}
                    onAnswerSelectionChange={(start, end) =>
                      handleAnswerSelectionChange(question.id, start, end, question.generatedAnswer ?? '')
                    }
                    fragmentSelectionContent={isFragmentSelected ? answerSelection.content : null}
                    fragmentSaveCategory={fragmentSaveCategory}
                    fragmentSaveDisabled={fragmentSaveDisabled}
                    fragmentCancelDisabled={fragmentSavePhase !== 'idle'}
                    fragmentSavePhase={fragmentSavePhase}
                    fragmentError={isFragmentSelected ? fragmentError : null}
                    onSaveFragment={() => {
                      void handleSaveFragment();
                    }}
                    onCancelFragment={handleCancelFragmentSelection}
                  />
                );
              })}
            </View>

            {isPartiallyAnswered && (
              <View style={styles.introCard}>
                <Text style={styles.errorText}>参考答案数据不完整，请稍后重试。</Text>
              </View>
            )}

            {answeredCount === 0 && (
              <View style={styles.introCard}>
                <Text style={styles.introText}>
                  AI 将根据你的 CV、岗位信息、面试问题和已保存的回答要点，生成 10 个英文参考答案。
                </Text>
                <Text style={styles.consentText}>
                  点击生成即表示你同意本次 AI 处理。生成前会先保存所有回答要点。
                </Text>

                {answerFlowError && <Text style={styles.errorText}>{answerFlowError}</Text>}

                <Pressable
                  onPress={handleGenerateAnswers}
                  disabled={answerFlowPhase !== 'idle'}
                  accessibilityRole="button"
                  accessibilityLabel="生成面试参考答案"
                  style={[
                    styles.generateButton,
                    styles.answerGenerateButton,
                    answerFlowPhase !== 'idle' && styles.generateButtonDisabled,
                  ]}>
                  {answerFlowPhase === 'saving_notes' ? (
                    <View style={styles.generateButtonRow}>
                      <ActivityIndicator color="#fff" />
                      <Text style={styles.generateButtonText}>正在保存回答要点…</Text>
                    </View>
                  ) : answerFlowPhase === 'generating_answers' ? (
                    <View style={styles.generateButtonRow}>
                      <ActivityIndicator color="#fff" />
                      <Text style={styles.generateButtonText}>正在生成参考答案…</Text>
                    </View>
                  ) : (
                    <Text style={styles.generateButtonText}>生成参考答案</Text>
                  )}
                </Pressable>
              </View>
            )}

            {isFullyAnswered && (
              <Text style={styles.fullyAnsweredNotice}>
                参考答案已生成，当前版本暂不支持重新生成。
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  invalidContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    padding: 20,
    gap: 12,
  },
  invalidText: {
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
  },
  detailActionButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  detailActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  flexContainer: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#F2F2F7',
    padding: 16,
    paddingTop: 14,
    gap: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  introCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  introText: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000',
  },
  consentText: {
    fontSize: 12,
    color: '#8e8e93',
  },
  errorText: {
    fontSize: 13,
    color: '#d9534f',
  },
  generateButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  answerGenerateButton: {
    minHeight: 48,
  },
  generateButtonDisabled: {
    opacity: 0.5,
  },
  generateButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  questionsList: {
    gap: 12,
  },
  questionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  questionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  questionIndex: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3c3c43',
  },
  questionTypeLabel: {
    fontSize: 12,
    color: '#8e8e93',
  },
  bookmarkButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkButtonDisabled: {
    opacity: 0.4,
  },
  savedErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  savedErrorBannerText: {
    fontSize: 13,
    color: '#8e8e93',
  },
  savedErrorRetryButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  savedErrorRetryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2f95dc',
  },
  questionText: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000',
  },
  noteLabel: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 4,
  },
  noteInput: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#000',
  },
  noteInputDisabled: {
    backgroundColor: '#F2F2F7',
  },
  savingText: {
    fontSize: 12,
    color: '#8e8e93',
  },
  saveErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  retryButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  retryButtonText: {
    fontSize: 13,
    color: '#2f95dc',
    fontWeight: '600',
  },
  answerLabel: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 8,
  },
  answerText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#000',
    padding: 0,
    textAlignVertical: 'top',
  },
  fragmentHintText: {
    fontSize: 12,
    color: '#8e8e93',
  },
  fragmentSelectionBox: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    padding: 12,
    gap: 6,
  },
  fragmentSelectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
  },
  fragmentSelectionPreview: {
    fontSize: 15,
    lineHeight: 20,
    color: '#000',
  },
  fragmentActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  fragmentCancelButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  fragmentCancelButtonText: {
    fontSize: 14,
    color: '#8e8e93',
    fontWeight: '600',
  },
  fragmentSaveButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  fragmentSaveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  fragmentSaveButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fullyAnsweredNotice: {
    fontSize: 12,
    color: '#8e8e93',
    textAlign: 'center',
  },
});
