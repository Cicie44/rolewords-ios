import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type {
  CreateInterviewDraftInput,
  GenerateInterviewAnswersResult,
  GenerateInterviewQuestionsResult,
  InterviewQuestion,
  InterviewQuestionType,
  InterviewSession,
  InterviewSessionDetail,
  InterviewSessionSummary,
  SaveInterviewQuestionNoteInput,
  UploadInterviewCvInput,
} from '@/src/types/interview';

type InterviewSessionRow = Database['public']['Tables']['interview_sessions']['Row'];

type SelectedInterviewSessionRow = Pick<
  InterviewSessionRow,
  | 'id'
  | 'job_title'
  | 'company_name'
  | 'job_description'
  | 'cv_storage_path'
  | 'cv_file_name'
  | 'cv_mime_type'
  | 'status'
  | 'created_at'
  | 'updated_at'
>;

const SELECT_COLUMNS =
  'id, job_title, company_name, job_description, cv_storage_path, cv_file_name, cv_mime_type, status, created_at, updated_at';

const CV_BUCKET = 'interview-cvs';
const CV_CONTENT_TYPE = 'application/pdf';
const MAX_CV_BYTES = 10 * 1024 * 1024;

// Converts one database row (snake_case) into the app's business type
// (camelCase), turning nullable columns into undefined. user_id is never
// selected in the first place, so it can't leak through here.
function rowToInterviewSession(row: SelectedInterviewSessionRow): InterviewSession {
  return {
    id: row.id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    jobDescription: row.job_description ?? undefined,
    cvStoragePath: row.cv_storage_path ?? undefined,
    cvFileName: row.cv_file_name ?? undefined,
    cvMimeType: row.cv_mime_type ?? undefined,
    status: row.status as InterviewSession['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cvStoragePathFor(userId: string, interviewSessionId: string): string {
  return `${userId}/${interviewSessionId}/cv.pdf`;
}

/**
 * Creates a new draft interview prep session for the current user.
 */
export async function createInterviewDraft(
  input: CreateInterviewDraftInput,
): Promise<InterviewSession> {
  const trimmedJobTitle = input.jobTitle.trim();
  const trimmedCompanyName = input.companyName.trim();

  if (trimmedJobTitle.length === 0 || trimmedCompanyName.length === 0) {
    throw new Error('Job title and company name are required.');
  }

  const trimmedDescription = input.jobDescription?.trim();
  const jobDescription = trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('interview_sessions')
    .insert({
      user_id: session.user.id,
      job_title: trimmedJobTitle,
      company_name: trimmedCompanyName,
      job_description: jobDescription,
      status: 'draft',
    })
    .select<string, SelectedInterviewSessionRow>(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('Failed to create interview draft.');
  }

  return rowToInterviewSession(data);
}

/**
 * Updates the job details of an existing draft interview session. Only
 * touches job_title/company_name/job_description/updated_at — CV fields and
 * status are left untouched, and the update only applies while the session
 * is still a draft.
 */
export async function updateInterviewDraft(
  interviewSessionId: string,
  input: CreateInterviewDraftInput,
): Promise<InterviewSession> {
  const trimmedSessionId = interviewSessionId.trim();
  const trimmedJobTitle = input.jobTitle.trim();
  const trimmedCompanyName = input.companyName.trim();

  if (
    trimmedSessionId.length === 0 ||
    trimmedJobTitle.length === 0 ||
    trimmedCompanyName.length === 0
  ) {
    throw new Error('Interview session id, job title, and company name are required.');
  }

  const trimmedDescription = input.jobDescription?.trim();
  const jobDescription = trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('interview_sessions')
    .update({
      job_title: trimmedJobTitle,
      company_name: trimmedCompanyName,
      job_description: jobDescription,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .eq('status', 'draft')
    .select<string, SelectedInterviewSessionRow>(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('Failed to update interview draft.');
  }

  return rowToInterviewSession(data);
}

/**
 * Uploads (or replaces) the CV PDF for an existing interview session. The
 * storage path is always derived by this function from the session's owner
 * and id — callers cannot influence where the file is written.
 */
export async function uploadInterviewCv(
  input: UploadInterviewCvInput,
): Promise<InterviewSession> {
  const trimmedSessionId = input.interviewSessionId.trim();
  const trimmedFileName = input.fileName.trim();

  if (trimmedSessionId.length === 0 || trimmedFileName.length === 0) {
    throw new Error('Interview session id and file name are required.');
  }

  if (input.data.byteLength === 0 || input.data.byteLength > MAX_CV_BYTES) {
    throw new Error('CV file is empty or exceeds the 10 MB limit.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data: existingRow, error: fetchError } = await supabase
    .from('interview_sessions')
    .select('cv_storage_path')
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (fetchError || !existingRow) {
    throw new Error('Interview session not found.');
  }

  const hadCvBefore = existingRow.cv_storage_path !== null;
  const storagePath = cvStoragePathFor(session.user.id, trimmedSessionId);

  const { error: uploadError } = await supabase.storage
    .from(CV_BUCKET)
    .upload(storagePath, input.data, { contentType: CV_CONTENT_TYPE, upsert: true });

  if (uploadError) {
    throw new Error('Failed to upload CV.');
  }

  const { data, error } = await supabase
    .from('interview_sessions')
    .update({
      cv_storage_path: storagePath,
      cv_file_name: trimmedFileName,
      cv_mime_type: CV_CONTENT_TYPE,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .select<string, SelectedInterviewSessionRow>(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    // Only clean up the object when nothing else was pointing at this path
    // before. If a CV already existed here, the upload just overwrote it in
    // place, so deleting now would destroy the file the untouched database
    // row still references.
    if (!hadCvBefore) {
      await supabase.storage.from(CV_BUCKET).remove([storagePath]).catch(() => undefined);
    }
    throw new Error('Failed to save the uploaded CV.');
  }

  return rowToInterviewSession(data);
}

/**
 * Removes the CV file (and its references) from an interview session. Only
 * ever deletes the exact path the session's own record points to, never an
 * arbitrary caller-supplied path.
 */
export async function removeInterviewCv(interviewSessionId: string): Promise<InterviewSession> {
  const trimmedSessionId = interviewSessionId.trim();

  if (trimmedSessionId.length === 0) {
    throw new Error('Interview session id is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data: existingRow, error: fetchError } = await supabase
    .from('interview_sessions')
    .select<string, SelectedInterviewSessionRow>(SELECT_COLUMNS)
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (fetchError || !existingRow) {
    throw new Error('Interview session not found.');
  }

  if (existingRow.cv_storage_path === null) {
    return rowToInterviewSession(existingRow);
  }

  const expectedPath = cvStoragePathFor(session.user.id, trimmedSessionId);
  if (existingRow.cv_storage_path !== expectedPath) {
    throw new Error('CV path does not match this session.');
  }

  // The database can point at a path that's already gone from Storage —
  // e.g. a retry after a previous attempt's remove() succeeded but the
  // follow-up database update failed. Checking first (rather than always
  // calling remove()) makes that retry path explicit instead of relying on
  // remove() silently no-op'ing for a missing object.
  let fileExists: boolean;
  try {
    const { data: existsData } = await supabase.storage.from(CV_BUCKET).exists(expectedPath);
    fileExists = existsData;
  } catch {
    throw new Error('Failed to check whether the CV file exists.');
  }

  if (fileExists) {
    const { error: removeError } = await supabase.storage.from(CV_BUCKET).remove([expectedPath]);

    if (removeError) {
      throw new Error('Failed to remove CV file.');
    }
  }

  const { data, error } = await supabase
    .from('interview_sessions')
    .update({
      cv_storage_path: null,
      cv_file_name: null,
      cv_mime_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .select<string, SelectedInterviewSessionRow>(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    // Storage is already clean at this point (the file was removed just now,
    // or was already gone); the database may still show the old path until
    // a retry succeeds.
    throw new Error('CV file storage cleanup succeeded, but failed to update the record.');
  }

  return rowToInterviewSession(data);
}

const INTERVIEW_QUESTION_TYPES: readonly InterviewQuestionType[] = [
  'behavioral',
  'technical',
  'role_specific',
  'general',
];

function isInterviewQuestionType(value: unknown): value is InterviewQuestionType {
  return typeof value === 'string' && (INTERVIEW_QUESTION_TYPES as readonly string[]).includes(value);
}

// The Edge Function's static return type isn't trusted — every field is
// re-checked at runtime before anything reaches the UI.
function parseGeneratedQuestions(value: unknown): InterviewQuestion[] | null {
  if (!Array.isArray(value) || value.length !== 10) {
    return null;
  }

  const parsed: InterviewQuestion[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const record = item as Record<string, unknown>;

    const { id, questionOrder, questionType, questionText, userNotes, generatedAnswer, createdAt, updatedAt } =
      record;

    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    if (
      typeof questionOrder !== 'number' ||
      !Number.isInteger(questionOrder) ||
      questionOrder < 1 ||
      questionOrder > 10
    ) {
      return null;
    }
    if (!isInterviewQuestionType(questionType)) {
      return null;
    }
    if (typeof questionText !== 'string' || questionText.trim().length === 0) {
      return null;
    }
    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
      return null;
    }
    if (userNotes !== undefined && typeof userNotes !== 'string') {
      return null;
    }
    if (generatedAnswer !== undefined && typeof generatedAnswer !== 'string') {
      return null;
    }

    parsed.push({
      id,
      questionOrder,
      questionType,
      questionText: questionText.trim(),
      userNotes: typeof userNotes === 'string' ? userNotes : undefined,
      generatedAnswer: typeof generatedAnswer === 'string' ? generatedAnswer : undefined,
      createdAt,
      updatedAt,
    });
  }

  parsed.sort((a, b) => a.questionOrder - b.questionOrder);

  const isSequential = parsed.every((question, index) => question.questionOrder === index + 1);
  if (!isSequential) {
    return null;
  }

  return parsed;
}

/**
 * Invokes the deployed generate-interview-questions Edge Function for an
 * existing interview session. Auth is handled entirely by the shared
 * Supabase client's active session — no Authorization header or Function
 * URL is built by hand here, and no OpenAI credentials ever pass through
 * this app.
 */
export async function generateInterviewQuestions(
  interviewSessionId: string,
): Promise<GenerateInterviewQuestionsResult> {
  const trimmedSessionId = interviewSessionId.trim();

  if (trimmedSessionId.length === 0) {
    throw new Error('Interview session id is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase.functions.invoke('generate-interview-questions', {
    body: { interviewSessionId: trimmedSessionId },
  });

  if (error || !data || typeof data !== 'object') {
    throw new Error('Failed to generate interview questions.');
  }

  const record = data as Record<string, unknown>;

  if (typeof record.reused !== 'boolean') {
    throw new Error('Failed to generate interview questions.');
  }

  const questions = parseGeneratedQuestions(record.questions);
  if (!questions) {
    throw new Error('Failed to generate interview questions.');
  }

  return { questions, reused: record.reused };
}

const MAX_GENERATED_ANSWER_LENGTH = 4000;

// Reuses the question-generation validator, then layers on the extra
// guarantees answer generation requires: every question must now carry a
// non-empty generatedAnswer within the length limit the Edge Function
// itself enforces. Does not loosen anything parseGeneratedQuestions already
// checks — generateInterviewQuestions still calls that function directly,
// unaffected by this wrapper.
function parseGeneratedAnswerQuestions(value: unknown): InterviewQuestion[] | null {
  const questions = parseGeneratedQuestions(value);
  if (!questions) {
    return null;
  }

  const result: InterviewQuestion[] = [];

  for (const question of questions) {
    if (typeof question.generatedAnswer !== 'string') {
      return null;
    }

    const trimmedAnswer = question.generatedAnswer.trim();
    if (trimmedAnswer.length === 0 || trimmedAnswer.length > MAX_GENERATED_ANSWER_LENGTH) {
      return null;
    }

    result.push({ ...question, generatedAnswer: trimmedAnswer });
  }

  return result;
}

/**
 * Invokes the deployed generate-interview-answers Edge Function for an
 * existing interview session. Auth is handled entirely by the shared
 * Supabase client's active session — no Authorization header or Function
 * URL is built by hand here, and no OpenAI credentials ever pass through
 * this app.
 */
export async function generateInterviewAnswers(
  interviewSessionId: string,
): Promise<GenerateInterviewAnswersResult> {
  const trimmedSessionId = interviewSessionId.trim();

  if (trimmedSessionId.length === 0) {
    throw new Error('Interview session id is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase.functions.invoke('generate-interview-answers', {
    body: { interviewSessionId: trimmedSessionId },
  });

  if (error || !data || typeof data !== 'object') {
    throw new Error('Failed to generate interview answers.');
  }

  const record = data as Record<string, unknown>;

  if (typeof record.reused !== 'boolean') {
    throw new Error('Failed to generate interview answers.');
  }

  const questions = parseGeneratedAnswerQuestions(record.questions);
  if (!questions) {
    throw new Error('Failed to generate interview answers.');
  }

  return { questions, reused: record.reused };
}

type InterviewQuestionRow = Database['public']['Tables']['interview_questions']['Row'];

type SelectedInterviewQuestionRow = Pick<
  InterviewQuestionRow,
  | 'id'
  | 'question_order'
  | 'question_type'
  | 'question_text'
  | 'user_notes'
  | 'generated_answer'
  | 'created_at'
  | 'updated_at'
>;

const QUESTION_SELECT_COLUMNS =
  'id, question_order, question_type, question_text, user_notes, generated_answer, created_at, updated_at';

function rowToInterviewQuestion(row: SelectedInterviewQuestionRow): InterviewQuestion {
  return {
    id: row.id,
    questionOrder: row.question_order,
    questionType: row.question_type as InterviewQuestionType,
    questionText: row.question_text,
    userNotes: row.user_notes ?? undefined,
    generatedAnswer: row.generated_answer ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Saves (or clears) the user's own notes for one interview question. Only
 * ever writes user_notes/updated_at — question content, type, order, the
 * generated answer, and the parent session link are never touched here.
 * interview_questions has no user_id of its own; ownership is enforced by
 * the existing RLS policies, which check the row's parent interview_sessions
 * record instead.
 */
export async function saveInterviewQuestionNote(
  input: SaveInterviewQuestionNoteInput,
): Promise<InterviewQuestion> {
  const trimmedSessionId = input.interviewSessionId.trim();
  const trimmedQuestionId = input.questionId.trim();

  if (trimmedSessionId.length === 0 || trimmedQuestionId.length === 0) {
    throw new Error('Interview session id and question id are required.');
  }

  const trimmedNotes = input.userNotes.trim();
  const userNotes = trimmedNotes.length > 0 ? trimmedNotes : null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('interview_questions')
    .update({
      user_notes: userNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trimmedQuestionId)
    .eq('interview_session_id', trimmedSessionId)
    .select<string, SelectedInterviewQuestionRow>(QUESTION_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('Failed to save interview question note.');
  }

  return rowToInterviewQuestion(data);
}

type SelectedInterviewSessionSummaryRow = Pick<
  InterviewSessionRow,
  'id' | 'job_title' | 'company_name' | 'status' | 'created_at' | 'updated_at'
>;

const SUMMARY_SELECT_COLUMNS = 'id, job_title, company_name, status, created_at, updated_at';

function rowToInterviewSessionSummary(
  row: SelectedInterviewSessionSummaryRow,
): InterviewSessionSummary {
  return {
    id: row.id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    status: row.status as InterviewSessionSummary['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists the current user's interview sessions for the history screen, newest
 * first. Only reads the fields a history list needs — no job description
 * and no CV path/file name/mime type — and never selects user_id, so it
 * can't leak through rowToInterviewSessionSummary.
 */
export async function fetchInterviewSessions(): Promise<InterviewSessionSummary[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data, error } = await supabase
    .from('interview_sessions')
    .select<string, SelectedInterviewSessionSummaryRow>(SUMMARY_SELECT_COLUMNS)
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch interview sessions.');
  }

  if (!data) {
    return [];
  }

  return data.map(rowToInterviewSessionSummary);
}

/**
 * Fetches one interview session's summary plus whatever questions (and any
 * notes/generated answers already on them) exist in the database. Purely
 * reads existing rows — never triggers question or answer generation, and
 * never downloads or reads the CV.
 */
export async function fetchInterviewSessionDetail(
  interviewSessionId: string,
): Promise<InterviewSessionDetail | null> {
  const trimmedSessionId = interviewSessionId.trim();

  if (trimmedSessionId.length === 0) {
    throw new Error('Interview session id is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from('interview_sessions')
    .select<string, SelectedInterviewSessionSummaryRow>(SUMMARY_SELECT_COLUMNS)
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (sessionError) {
    throw new Error('Failed to fetch interview session detail.');
  }

  if (!sessionRow) {
    // A session that doesn't exist and one owned by someone else are
    // indistinguishable here — both resolve to null rather than leaking
    // whether the id exists at all.
    return null;
  }

  const { data: questionRows, error: questionsError } = await supabase
    .from('interview_questions')
    .select<string, SelectedInterviewQuestionRow>(QUESTION_SELECT_COLUMNS)
    .eq('interview_session_id', trimmedSessionId)
    .order('question_order', { ascending: true });

  if (questionsError) {
    throw new Error('Failed to fetch interview session detail.');
  }

  return {
    session: rowToInterviewSessionSummary(sessionRow),
    questions: (questionRows ?? []).map(rowToInterviewQuestion),
  };
}

/**
 * Permanently deletes one interview session: the uploaded CV (if any), the
 * session row itself, and — via the existing interview_questions foreign
 * key's ON DELETE CASCADE — every question and generated answer under it.
 * Never touches saved_items; a user's bookmarks survive regardless of what
 * they were sourced from.
 *
 * Privacy-first ordering: the CV is removed from private Storage (by
 * delegating to removeInterviewCv, the same function the CV-management flow
 * already uses) before the session row is deleted, so a failure partway
 * through can never leave an orphaned CV file. Safe to call again after a
 * partial failure — a session with no CV left skips straight to deleting the
 * row, and a session that no longer exists (already deleted, or never
 * belonged to this user) is treated as already deleted rather than an error.
 * Genuine Storage/database failures are never swallowed.
 */
export async function deleteInterviewSession(interviewSessionId: string): Promise<void> {
  const trimmedSessionId = interviewSessionId.trim();

  if (trimmedSessionId.length === 0) {
    throw new Error('Interview session id is required.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated.');
  }

  const { data: existingRow, error: fetchError } = await supabase
    .from('interview_sessions')
    .select('cv_storage_path')
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (fetchError) {
    throw new Error('Failed to load interview session.');
  }

  if (!existingRow) {
    // Nothing left to delete — either already deleted by a previous
    // (possibly partially-failed) attempt, or it never belonged to this
    // user. Both cases resolve as a successful no-op, matching
    // fetchInterviewSessionDetail's existing "don't distinguish missing
    // from someone else's" privacy stance.
    return;
  }

  if (existingRow.cv_storage_path !== null) {
    await removeInterviewCv(trimmedSessionId);
  }

  const { error: deleteError } = await supabase
    .from('interview_sessions')
    .delete()
    .eq('id', trimmedSessionId)
    .eq('user_id', session.user.id);

  if (deleteError) {
    throw new Error('Failed to delete interview session.');
  }
}
