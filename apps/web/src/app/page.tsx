"use client";

import { useUser, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function Home() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [apiData, setApiData] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    async function load() {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("http://localhost:8000/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setApiData(await res.json());
    }
    load();
  }, [getToken]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-24">
      <div className="absolute top-6 right-6">
        <UserButton />
      </div>

      <h1 className="text-4xl font-bold tracking-tight">VillageOS</h1>

      <p className="text-xl">
        Hello, {user?.firstName ?? "…"} {user?.lastName ?? ""}!
      </p>

      <div className="rounded-lg border p-4 text-sm font-mono bg-muted w-full max-w-md">
        <p className="text-muted-foreground mb-2 font-sans text-xs uppercase tracking-wide">
          FastAPI /api/me response
        </p>
        <pre>{apiData ? JSON.stringify(apiData, null, 2) : "loading…"}</pre>
      </div>
    </main>
  );
}
