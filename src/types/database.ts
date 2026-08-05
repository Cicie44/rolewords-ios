export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      interview_questions: {
        Row: {
          created_at: string
          generated_answer: string | null
          id: string
          interview_session_id: string
          question_order: number
          question_text: string
          question_type: string
          updated_at: string
          user_notes: string | null
        }
        Insert: {
          created_at?: string
          generated_answer?: string | null
          id?: string
          interview_session_id: string
          question_order: number
          question_text: string
          question_type: string
          updated_at?: string
          user_notes?: string | null
        }
        Update: {
          created_at?: string
          generated_answer?: string | null
          id?: string
          interview_session_id?: string
          question_order?: number
          question_text?: string
          question_type?: string
          updated_at?: string
          user_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_questions_interview_session_id_fkey"
            columns: ["interview_session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_sessions: {
        Row: {
          company_name: string
          created_at: string
          cv_file_name: string | null
          cv_mime_type: string | null
          cv_storage_path: string | null
          id: string
          job_description: string | null
          job_title: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          cv_file_name?: string | null
          cv_mime_type?: string | null
          cv_storage_path?: string | null
          id?: string
          job_description?: string | null
          job_title: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          cv_file_name?: string | null
          cv_mime_type?: string | null
          cv_storage_path?: string | null
          id?: string
          job_description?: string | null
          job_title?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_items: {
        Row: {
          chinese_text: string | null
          content: string
          created_at: string
          id: string
          item_type: string
          source_id: string | null
          source_type: string
          user_id: string
        }
        Insert: {
          chinese_text?: string | null
          content: string
          created_at?: string
          id?: string
          item_type: string
          source_id?: string | null
          source_type: string
          user_id?: string
        }
        Update: {
          chinese_text?: string | null
          content?: string
          created_at?: string
          id?: string
          item_type?: string
          source_id?: string | null
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_word_progress: {
        Row: {
          created_at: string
          familiarity: string
          last_reviewed_at: string | null
          needs_learn_reinforcement: boolean
          next_review_at: string | null
          recognition_count: number
          review_count: number
          status: string
          updated_at: string
          user_id: string
          vocabulary_item_id: string
        }
        Insert: {
          created_at?: string
          familiarity?: string
          last_reviewed_at?: string | null
          needs_learn_reinforcement?: boolean
          next_review_at?: string | null
          recognition_count?: number
          review_count?: number
          status?: string
          updated_at?: string
          user_id?: string
          vocabulary_item_id: string
        }
        Update: {
          created_at?: string
          familiarity?: string
          last_reviewed_at?: string | null
          needs_learn_reinforcement?: boolean
          next_review_at?: string | null
          recognition_count?: number
          review_count?: number
          status?: string
          updated_at?: string
          user_id?: string
          vocabulary_item_id?: string
        }
        Relationships: []
      }
      vocabulary_items: {
        Row: {
          chinese_meaning: string
          created_at: string
          english_definition: string | null
          example_sentence: string | null
          example_translation: string | null
          id: string
          ipa: string | null
          is_active: boolean
          part_of_speech: string | null
          pronunciation_text: string | null
          sort_order: number
          tags: string[]
          term: string
          updated_at: string
          word_book_id: string
        }
        Insert: {
          chinese_meaning: string
          created_at?: string
          english_definition?: string | null
          example_sentence?: string | null
          example_translation?: string | null
          id: string
          ipa?: string | null
          is_active?: boolean
          part_of_speech?: string | null
          pronunciation_text?: string | null
          sort_order: number
          tags?: string[]
          term: string
          updated_at?: string
          word_book_id: string
        }
        Update: {
          chinese_meaning?: string
          created_at?: string
          english_definition?: string | null
          example_sentence?: string | null
          example_translation?: string | null
          id?: string
          ipa?: string | null
          is_active?: boolean
          part_of_speech?: string | null
          pronunciation_text?: string | null
          sort_order?: number
          tags?: string[]
          term?: string
          updated_at?: string
          word_book_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_items_word_book_id_fkey"
            columns: ["word_book_id"]
            isOneToOne: false
            referencedRelation: "word_books"
            referencedColumns: ["id"]
          },
        ]
      }
      word_books: {
        Row: {
          category: string
          chinese_title: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          chinese_title: string
          created_at?: string
          description: string
          id: string
          is_active?: boolean
          sort_order: number
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          chinese_title?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
