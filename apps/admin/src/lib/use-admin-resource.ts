"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, NotAuthenticated, adminGet } from "@/lib/api";

/** The same load/auth/forbidden/error states the dashboard hand-rolls, lifted so
 *  the evals + golden pages gate identically. NotAuthenticated → /login; a 403 is
 *  surfaced as "forbidden" (signed in, not an admin). */
export type Resource<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export function useAdminResource<T>(path: string): Resource<T> {
  const router = useRouter();
  const [state, setState] = useState<Resource<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminGet<T>(path);
        if (!cancelled) setState({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof NotAuthenticated) {
          router.replace("/login");
        } else if (e instanceof ApiError && e.status === 403) {
          setState({ status: "forbidden" });
        } else {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, router]);

  return state;
}
