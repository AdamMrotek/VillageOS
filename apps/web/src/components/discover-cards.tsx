import Image from "next/image";
import Link from "next/link";
import { CATEGORY_LABELS, KIND_LABELS } from "@/components/provider-card";
import { spotsLeftLabel } from "@/components/provider-event-card";
import { CALENDAR_LOCALE } from "@/lib/config/calendar";
import { eventTypeStyle } from "@/lib/event-styles";
import { providerCategoryStyle } from "@/lib/provider-styles";
import type { DiscoverEvent, DiscoverFeatured } from "@/lib/types/discover";
import type { StoredProviderProfile } from "@/lib/types/providers";
import { formatEventWhen } from "@/lib/utils/event-changes";
import { formatTime } from "@/lib/utils/date";

/** Cards land on the provider's page, scrolled to the event, where the
 *  Reserve button is. */
export function eventHref(event: DiscoverEvent): string {
  return `/discover/${event.provider_id}#event-${event.id}`;
}

/** "Sat 22 Nov · 10:00", short enough for a card. */
function shortWhen(event: DiscoverEvent): string {
  const start = new Date(event.start_time);
  const day = start.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return event.is_all_day ? `${day} · All day` : `${day} · ${formatTime(start)}`;
}

function SpotsLine({ event }: { event: DiscoverEvent }) {
  return (
    <p className="flex items-center gap-2 text-xs text-ink-mute">
      {event.my_spots > 0 ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-ink">
          Reserved
        </span>
      ) : null}
      <span>{spotsLeftLabel(event)}</span>
    </p>
  );
}

const tileBase =
  "flex h-full flex-col rounded-lg border border-input bg-surface transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EventTile({ event }: { event: DiscoverEvent }) {
  return (
    <Link
      href={eventHref(event)}
      className={`${tileBase} gap-1 p-4 ${eventTypeStyle(event.event_type).border}`}
    >
      <p className="text-xs font-medium text-ink-soft">{shortWhen(event)}</p>
      <h3 className="line-clamp-2 text-body font-medium text-ink">
        {event.title}
      </h3>
      {event.provider_name && (
        <p className="truncate text-sm text-ink-soft">{event.provider_name}</p>
      )}
      <div className="mt-auto pt-2">
        <SpotsLine event={event} />
      </div>
    </Link>
  );
}

function ProviderImage({
  provider,
  sizes,
}: {
  provider: StoredProviderProfile;
  sizes: string;
}) {
  const style = providerCategoryStyle(provider.category);
  return (
    <div
      className={`relative aspect-[16/9] w-full overflow-hidden ${style.bg}`}
    >
      {provider.image_url ? (
        <Image
          src={provider.image_url}
          alt=""
          fill
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-title text-ink-soft"
        >
          {provider.name.charAt(0)}
        </span>
      )}
    </div>
  );
}

/** "Venue · Council", or just the category for an organiser. */
function providerKicker(provider: StoredProviderProfile): string {
  const category = CATEGORY_LABELS[provider.category];
  return provider.kind === "organiser"
    ? category
    : `${KIND_LABELS[provider.kind]} · ${category}`;
}

export function ProviderTile({ provider }: { provider: StoredProviderProfile }) {
  return (
    <Link
      href={`/discover/${provider.user_id}`}
      className={`${tileBase} overflow-hidden`}
    >
      <ProviderImage provider={provider} sizes="240px" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-xs font-medium text-ink-soft">
          {providerKicker(provider)}
        </p>
        <h3 className="line-clamp-2 text-body font-medium text-ink">
          {provider.name}
        </h3>
        {provider.location && (
          <p className="mt-auto truncate text-sm text-ink-soft">
            {provider.location}
          </p>
        )}
      </div>
    </Link>
  );
}

/** The large card above the rows. */
export function FeaturedCard({ featured }: { featured: DiscoverFeatured }) {
  if (featured.item_type === "event") {
    const event = featured.item;
    const start = new Date(event.start_time);
    const accent = event.provider_category
      ? providerCategoryStyle(event.provider_category).bg
      : eventTypeStyle(event.event_type).bg;
    return (
      <Link
        href={eventHref(event)}
        className={`${tileBase} overflow-hidden sm:flex-row`}
      >
        <div
          className={`flex shrink-0 flex-col items-center justify-center gap-1 px-8 py-6 sm:w-48 ${accent}`}
        >
          <span className="text-eyebrow">
            {start.toLocaleDateString(CALENDAR_LOCALE, { month: "short" })}
          </span>
          <span className="text-5xl font-semibold leading-none text-ink">
            {start.getDate()}
          </span>
          <span className="text-sm text-ink-soft">
            {start.toLocaleDateString(CALENDAR_LOCALE, { weekday: "long" })}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
          <p className="text-eyebrow">Featured event</p>
          <h2 className="text-title text-ink">{event.title}</h2>
          <p className="text-sm text-ink-soft">
            {[event.provider_name, formatEventWhen(event), event.location]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {event.description && (
            <p className="line-clamp-2 text-body text-ink">
              {event.description}
            </p>
          )}
          <div className="mt-auto pt-2">
            <SpotsLine event={event} />
          </div>
        </div>
      </Link>
    );
  }

  const provider = featured.item;
  return (
    <Link
      href={`/discover/${provider.user_id}`}
      className={`${tileBase} overflow-hidden sm:flex-row`}
    >
      <div className="sm:w-72 sm:shrink-0">
        <ProviderImage provider={provider} sizes="(min-width: 640px) 288px, 100vw" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
        <p className="text-eyebrow">Featured · {providerKicker(provider)}</p>
        <h2 className="text-title text-ink">{provider.name}</h2>
        {provider.location && (
          <p className="text-sm text-ink-soft">{provider.location}</p>
        )}
        {provider.description && (
          <p className="line-clamp-3 text-body text-ink">
            {provider.description}
          </p>
        )}
      </div>
    </Link>
  );
}
