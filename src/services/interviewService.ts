import { supabase } from '@/src/services/supabase';
import type { Database } from '@/src/types/database';
import type {
  CreateInterviewDraftInput,
  GenerateInterviewQuestionsResult,
  InterviewQuestion,
  InterviewQuestionType,
  InterviewSession,
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

  const { error: removeError } = await supabase.storage.from(CV_BUCKET).remove([expectedPath]);

  if (removeError) {
    throw new Error('Failed to remove CV file.');
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
    // The file is already gone from storage at this point; the database may
    // still show the old path until a retry succeeds.
    throw new Error('CV file removed, but failed to update the record.');
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
