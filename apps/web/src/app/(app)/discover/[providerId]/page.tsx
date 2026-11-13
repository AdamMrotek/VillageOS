"use client";

import Image from "next/image";
import { use } from "react";
import PageLayout from "@/components/page-layout";
import { CategoryBadge } from "@/components/provider-card";
import ProviderEventCard from "@/components/provider-event-card";
import { useProviderEvents } from "@/lib/queries/provider-events";
import { useProvider } from "@/lib/queries/providers";

export default function ProviderDetailPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = use(params);
  const { data: provider, isLoading, isError } = useProvider(providerId);
  const { data: events, isError: eventsError } = useProviderEvents(providerId);

  return (
    <PageLayout
      title={provider?.name ?? "Provider"}
      backHref="/discover"
      backLabel="Discover"
      action={provider ? <CategoryBadge category={provider.category} /> : null}
    >
      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">Provider not found.</p>
      )}

      {provider && (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex-1 space-y-4">
            {provider.location && (
              <p className="text-body text-ink-soft">{provider.location}</p>
            )}
            {provider.description && (
              <p className="text-body text-ink">{provider.description}</p>
            )}
            {provider.website && (
              <a
                href={provider.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-fit break-all text-body text-primary underline underline-offset-4"
              >
                {provider.website}
              </a>
            )}
            {provider.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {provider.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-input bg-surface px-2 py-0.5 text-xs text-ink-soft"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          {provider.image_url && (
            <div className="relative aspect-square w-40 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 md:w-56">
              <Image
                src={provider.image_url}
                alt=""
                fill
                sizes="224px"
                className="object-cover"
              />
            </div>
          )}
        </div>
      )}

      {provider && (
        <section aria-labelledby="upcoming-events" className="space-y-3">
          <h2 id="upcoming-events" className="text-heading text-ink">
            Upcoming events
          </h2>
          {eventsError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load events. Please try again.
            </p>
          )}
          {events && events.length === 0 && (
            <p className="text-sm text-ink-soft">No upcoming events.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {events?.map((event) => (
              <ProviderEventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </PageLayout>
  );
}
