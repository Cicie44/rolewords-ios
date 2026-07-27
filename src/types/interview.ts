export type InterviewSessionStatus =
  | 'draft'
  | 'questions_ready'
  | 'answers_ready'
  | 'completed'
  | 'failed';

export interface InterviewSession {
  id: string;
  jobTitle: string;
  companyName: string;
  jobDescription?: string;
  cvStoragePath?: string;
  cvFileName?: string;
  cvMimeType?: string;
  status: InterviewSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInterviewDraftInput {
  jobTitle: string;
  companyName: string;
  jobDescription?: string;
}

export interface UploadInterviewCvInput {
  interviewSessionId: string;
  fileName: string;
  data: ArrayBuffer;
}

export type InterviewQuestionType = 'behavioral' | 'technical' | 'role_specific' | 'general';

export interface InterviewQuestion {
  id: string;
  questionOrder: number;
  questionType: InterviewQuestionType;
  questionText: string;
  userNotes?: string;
  generatedAnswer?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateInterviewQuestionsResult {
  questions: InterviewQuestion[];
  reused: boolean;
}
