export type Row = Record<string, unknown>;
export type DataType = "string" | "integer" | "float" | "date" | "boolean";
export type Severity = "critical" | "error" | "warning";

export type RuleType =
  | "required_columns"
  | "data_type"
  | "not_null"
  | "duplicate"
  | "range"
  | "custom"
  | "record_count"
  | "allowed_values";

export interface RuleParams {
  columns?: string[]; // required_columns, duplicate
  allowExtraColumns?: boolean; // required_columns
  type?: DataType; // data_type
  treatEmptyAsNull?: boolean; // not_null
  fillValue?: string | null; // not_null — cleaning: fill instead of reject
  min?: number | null; // range / record_count
  max?: number | null;
  operator?: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "email" | "regex";
  value?: string | number | null; // custom
  maxChangePct?: number | null; // record_count vs previous run
  format?: string; // data_type date — "YYYY-MM-DD" restricts to that exact date-only format; omitted = any real calendar date
  values?: string[]; // allowed_values — the approved list
  caseSensitive?: boolean; // allowed_values — default false (trimmed, case-insensitive)
  ignoreEmpty?: boolean; // duplicate — blank key values are not "duplicates" of each other (use not_null for blanks)
  caseInsensitive?: boolean; // duplicate — compare keys ignoring case
}

export interface Rule {
  id: string;
  rule_name: string;
  column_name: string | null;
  rule_type: RuleType;
  parameters: RuleParams;
  severity: Severity;
  is_enabled: boolean;
}

export interface ColumnInfo {
  name: string;
  type: DataType;
  nullCount: number;
}

export interface Violation {
  row_number: number | null; // null = dataset-level
  column_name: string | null;
  rule_id: string | null;
  rule_name: string;
  error_type: string;
  severity: Severity;
  error_message: string;
  fixable?: boolean | undefined; // will be resolved by cleaning (fill)
}

export interface ProcessingOptions {
  trimWhitespace: boolean;
  lowercaseEmails: boolean;
  rejectOnWarning: boolean;
}

export const DEFAULT_OPTIONS: ProcessingOptions = {
  trimWhitespace: true,
  lowercaseEmails: true,
  rejectOnWarning: false,
};

export type StageName = "ingest" | "validate" | "clean" | "load" | "publish";
export type StageStatus = "pending" | "running" | "completed" | "failed";
export const STAGES: StageName[] = ["ingest", "validate", "clean", "load", "publish"];

/** "not_evaluated" = the run completed but no executable validation rule existed, so quality is unknown (never 100%). */
export type RunStatus = "pending" | "running" | "success" | "partial_success" | "failed" | "not_evaluated";
