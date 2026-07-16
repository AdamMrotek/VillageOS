import { createClient } from "@repo/ui/lib/supabase";

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

/** Call an admin endpoint with the current session's bearer token. Throws
 *  NotAuthenticated when there's no session and ApiError on a non-2xx. */
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new NotAuthenticated();

  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
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
  // 204 (no body) callers don't read the result; everything else is JSON.
  return res.status === 204 ? (undefined as T) : res.json();
}

/** GET an admin endpoint. */
export function adminGet<T>(path: string): Promise<T> {
  return adminFetch<T>(path);
}

/** PATCH an admin endpoint with a JSON body. */
export function adminPatch<T>(path: string, body: unknown): Promise<T> {
  return adminFetch<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** GET an admin endpoint that returns binary (e.g. a golden image). The bearer
 *  header can't ride on a plain <img src>, so the caller turns this blob into an
 *  object URL. Throws NotAuthenticated / ApiError like the JSON helpers. */
export async function adminGetBlob(path: string): Promise<Blob> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new NotAuthenticated();

  const res = await fetch(`${API_URL}${path}`, {
    // Honour the response's Cache-Control. The only caller is golden images,
    // which are immutable fixtures the server marks cacheable — so re-expanding
    // a case or reloading serves from the browser cache instead of refetching.
    cache: "default",
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
  return res.blob();
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

// ── The /api/admin/experiments/extraction/config response shape ─────────────
export type ExperimentConfig = {
  enabled: boolean;
  variants: Record<string, number>;
  default_variant: string;
};
