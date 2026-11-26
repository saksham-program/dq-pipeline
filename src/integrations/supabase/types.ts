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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accepted_records: {
        Row: {
          created_at: string
          dataset_id: string | null
          id: string
          record_data: Json
          row_number: number
          run_id: string
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          record_data: Json
          row_number: number
          run_id: string
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          record_data?: Json
          row_number?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accepted_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: number
          settings: Json
          updated_at: string
        }
        Insert: {
          id?: number
          settings?: Json
          updated_at?: string
        }
        Update: {
          id?: number
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      datasets: {
        Row: {
          api_headers: Json
          api_method: string | null
          created_at: string
          id: string
          is_sample: boolean
          name: string
          raw_records: Json
          record_count: number
          requires_auth: boolean
          schema_metadata: Json
          source_reference: string | null
          source_type: string
          status: string
          updated_at: string
          uploaded_filename: string | null
        }
        Insert: {
          api_headers?: Json
          api_method?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          name: string
          raw_records?: Json
          record_count?: number
          requires_auth?: boolean
          schema_metadata?: Json
          source_reference?: string | null
          source_type: string
          status?: string
          updated_at?: string
          uploaded_filename?: string | null
        }
        Update: {
          api_headers?: Json
          api_method?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          name?: string
          raw_records?: Json
          record_count?: number
          requires_auth?: boolean
          schema_metadata?: Json
          source_reference?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          uploaded_filename?: string | null
        }
        Relationships: []
      }
      pipeline_logs: {
        Row: {
          id: string
          log_level: string
          message: string
          run_id: string
          seq: number
          stage: string
          timestamp: string
        }
        Insert: {
          id?: string
          log_level?: string
          message: string
          run_id: string
          seq?: number
          stage: string
          timestamp?: string
        }
        Update: {
          id?: string
          log_level?: string
          message?: string
          run_id?: string
          seq?: number
          stage?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          accepted_count: number
          completed_at: string | null
          created_at: string
          dataset_id: string | null
          dataset_name: string
          duration_ms: number | null
          error_message: string | null
          id: string
          is_sample: boolean
          load_failure_count: number
          loaded_count: number
          reconciliation_status: string | null
          rejected_count: number
          run_id: string
          schema_snapshot: Json
          source_count: number
          source_type: string
          stages: Json
          started_at: string
          status: string
          violation_count: number
        }
        Insert: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          dataset_id?: string | null
          dataset_name: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          is_sample?: boolean
          load_failure_count?: number
          loaded_count?: number
          reconciliation_status?: string | null
          rejected_count?: number
          run_id: string
          schema_snapshot?: Json
          source_count?: number
          source_type: string
          stages?: Json
          started_at?: string
          status?: string
          violation_count?: number
        }
        Update: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          dataset_id?: string | null
          dataset_name?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          is_sample?: boolean
          load_failure_count?: number
          loaded_count?: number
          reconciliation_status?: string | null
          rejected_count?: number
          run_id?: string
          schema_snapshot?: Json
          source_count?: number
          source_type?: string
          stages?: Json
          started_at?: string
          status?: string
          violation_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      rejected_records: {
        Row: {
          created_at: string
          dataset_id: string | null
          id: string
          max_severity: string
          record_data: Json
          rejection_reasons: Json
          row_number: number
          run_id: string
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          max_severity?: string
          record_data: Json
          rejection_reasons?: Json
          row_number: number
          run_id: string
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          max_severity?: string
          record_data?: Json
          rejection_reasons?: Json
          row_number?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rejected_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejected_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      validation_results: {
        Row: {
          column_name: string | null
          created_at: string
          error_message: string
          error_type: string
          id: string
          record_data: Json | null
          row_number: number | null
          rule_id: string | null
          rule_name: string | null
          run_id: string
          severity: string
        }
        Insert: {
          column_name?: string | null
          created_at?: string
          error_message: string
          error_type: string
          id?: string
          record_data?: Json | null
          row_number?: number | null
          rule_id?: string | null
          rule_name?: string | null
          run_id: string
          severity: string
        }
        Update: {
          column_name?: string | null
          created_at?: string
          error_message?: string
          error_type?: string
          id?: string
          record_data?: Json | null
          row_number?: number | null
          rule_id?: string | null
          rule_name?: string | null
          run_id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      validation_rules: {
        Row: {
          column_name: string | null
          created_at: string
          dataset_id: string
          id: string
          is_enabled: boolean
          parameters: Json
          rule_name: string
          rule_type: string
          severity: string
        }
        Insert: {
          column_name?: string | null
          created_at?: string
          dataset_id: string
          id?: string
          is_enabled?: boolean
          parameters?: Json
          rule_name: string
          rule_type: string
          severity?: string
        }
        Update: {
          column_name?: string | null
          created_at?: string
          dataset_id?: string
          id?: string
          is_enabled?: boolean
          parameters?: Json
          rule_name?: string
          rule_type?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_rules_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reset_demo_workspace: { Args: never; Returns: undefined }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
