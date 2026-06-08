import Link from "next/link";
import type {
  ProviderCategory,
  StoredProviderProfile,
} from "@/lib/types/providers";

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  school: "School",
  sports_club: "Sports club",
  community: "Community",
  council: "Council",
  library: "Library",
  other: "Other",
};

export function CategoryBadge({ category }: { category: ProviderCategory }) {
  return (
    <span className="inline-flex items-center rounded-full border border-input bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export default function ProviderCard({
  provider,
}: {
  provider: StoredProviderProfile;
}) {
  return (
    <Link
      href={`/discover/${provider.user_id}`}
      className="block rounded-lg border border-input bg-surface p-4 transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{provider.name}</h3>
        <CategoryBadge category={provider.category} />
      </div>
      {provider.location && (
        <p className="mt-1 text-sm text-ink-soft">{provider.location}</p>
      )}
      {provider.description && (
        <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
          {provider.description}
        </p>
      )}
    </Link>
  );
}
