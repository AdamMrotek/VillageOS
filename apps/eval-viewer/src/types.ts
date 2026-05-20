// Mirrors evals.extraction.run.result_to_row in the API.
// Keep in sync if new fields are added there.

export interface RuleCheck {
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface GraderVerdict {
  model: string;
  score: number; // 1..10
  strengths: string[];
  weaknesses: string[];
  explanation: string;
  tokens_used: number | null;
  cost_usd: number | null;
}

export interface EvalRow {
  run_id: string;
  case_id: string;
  provider: string;
  model: string;
  prompt_version: string;
  frozen_today: string;
  expected: Record<string, unknown>;
  actual_event: Record<string, unknown> | null;
  rule_checks: RuleCheck[];
  rule_pass_count: number;
  rule_total: number;
  rule_all_passed: boolean;
  latency_s: number | null;
  tokens_used: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  instructor_mode: string | null;
  extraction_cost_usd: number | null;
  error: string | null;
  grader: GraderVerdict | null;
  grader_error: string | null;
}

export interface RunGroup {
  run_id: string;
  timestamp: string; // pretty
  rows: EvalRow[];
}
