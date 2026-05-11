const API_URL = process.env.NEXT_PUBLIC_API_URL!;

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
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as never;
  return res.json();
}
