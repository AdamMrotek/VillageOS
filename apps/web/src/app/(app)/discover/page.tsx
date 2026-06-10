"use client";

import { useEffect, useState } from "react";
import PageLayout from "@/components/page-layout";
import ProviderCard from "@/components/provider-card";
import { useProviders } from "@/lib/queries/providers";

export default function DiscoverPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  // Debounce the search input so we don't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(id);
  }, [input]);

  const { data: providers, isLoading, isError } = useProviders(query);

  return (
    <PageLayout title="Discover providers">
      <input
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search providers by name…"
        className="flex h-10 w-full rounded-md border border-input bg-surface px-3 text-body shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load providers. Please try again.
        </p>
      )}
      {providers && providers.length === 0 && (
        <p className="text-sm text-ink-soft">
          {query ? `No providers match "${query}".` : "No providers yet."}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {providers?.map((provider) => (
          <ProviderCard key={provider.user_id} provider={provider} />
        ))}
      </div>
    </PageLayout>
  );
}
