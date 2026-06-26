import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

/** Signalled when there's no session at all — the dashboard redirects to /login.
 *  Distinct from a 403 (signed in, but not an admin), which we want to show. */
export class NotAuthenticated extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

/** GET an admin endpoint with the current session's bearer token. */
export async function adminGet<T>(path: string): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new NotAuthenticated();

  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail)?.detail ?? detail;
    } catch {
      // non-JSON body — keep raw text
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

// ── The /api/admin/experiments/extraction response shape ───────────────────
export type OutcomeRow = {
  model: string;
  shown: number;
  accepted: number;
  re_extracted: number;
  discarded: number;
  not_completed: number;
  completion_pct: number | null;
  discard_pct: number | null;
  reextract_pct: number | null;
};

export type FieldEditRow = {
  field: string;
  control_pct: number | null;
  treatment_pct: number | null;
};

export type ExtractionReadout = {
  outcomes: OutcomeRow[];
  field_edits: FieldEditRow[];
};
