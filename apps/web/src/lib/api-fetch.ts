const API_URL = process.env.NEXT_PUBLIC_API_URL!;

/** Thrown on a non-2xx API response. Carries the HTTP status so callers can
 *  branch on it (e.g. a 429 quota hit → "sign up to continue" CTA). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** FastAPI's `detail` string when present, else the raw body. */
    readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

export async function authedFetch(
  token: string | undefined,
  path: string,
  init?: RequestInit,
) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    // FastAPI errors are `{"detail": "..."}`; fall back to the raw body.
    let detail = text;
    try {
      detail = JSON.parse(text)?.detail ?? text;
    } catch {
      // non-JSON body — keep the raw text
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as never;
  return res.json();
}
