"use client";

import { useEffect, useState } from "react";
import { FeaturedCard } from "@/components/discover-cards";
import DiscoverRowSection from "@/components/discover-row";
import PageLayout from "@/components/page-layout";
import ProviderCard from "@/components/provider-card";
import { useDiscoverHome } from "@/lib/queries/discover";
import { useProviders } from "@/lib/queries/providers";
import type { DiscoverKind } from "@/lib/types/discover";

const KIND_CHIPS: { kind: DiscoverKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "event", label: "Events" },
  { kind: "venue", label: "Venues" },
  { kind: "entertainer", label: "Entertainers" },
];

export default function DiscoverPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DiscoverKind>("all");

  // Debounce the search input so we don't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(id);
  }, [input]);

  // Typing switches from browsing to the search results grid.
  const searching = input.trim() !== "";

  return (
    <PageLayout title="Discover">
      <div className="space-y-3">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search providers by name…"
          aria-label="Search providers"
          className="flex h-10 w-full rounded-md border border-input bg-surface px-3 text-body shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {!searching && (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {KIND_CHIPS.map((chip) => (
              <button
                key={chip.kind}
                type="button"
                aria-pressed={kind === chip.kind}
                onClick={() => setKind(chip.kind)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  kind === chip.kind
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-surface text-ink-soft hover:bg-surface-alt hover:text-ink"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {searching ? <SearchResults query={query} /> : <Browse kind={kind} />}
    </PageLayout>
  );
}

function Browse({ kind }: { kind: DiscoverKind }) {
  const { data, isLoading, isError } = useDiscoverHome(kind);

  if (isLoading) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load Discover. Please try again.
      </p>
    );
  }
  if (!data.featured && data.rows.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Nothing here yet. Check back soon.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {data.featured && <FeaturedCard featured={data.featured} />}
      {data.rows.map((row) => (
        <DiscoverRowSection key={row.id} row={row} />
      ))}
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const { data: providers, isLoading, isError } = useProviders(query);

  return (
    <>
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
    </>
  );
}
