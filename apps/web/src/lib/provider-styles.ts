import type { ProviderCategory } from "@/lib/types/providers";

export type ProviderCategoryStyle = {
  label: string;
  dot: string;
  bg: string;
  border: string;
};

// Mirrors the palette in event-styles.ts so providers and events read as one
// colour language. Where a category lines up with an event type (school →
// school, sports_club → sport) the colour is intentionally the same.
export const PROVIDER_CATEGORY_STYLES: Record<
  ProviderCategory,
  ProviderCategoryStyle
> = {
  school: {
    label: "School",
    dot: "bg-[hsl(214_32%_52%)]",
    bg: "bg-[hsl(214_28%_91%)]",
    border: "border-l-[3px] border-l-[hsl(214_32%_52%)]",
  },
  sports_club: {
    label: "Sports club",
    dot: "bg-accent",
    bg: "bg-accent-soft",
    border: "border-l-[3px] border-l-accent",
  },
  community: {
    label: "Community",
    dot: "bg-warm",
    bg: "bg-warm-surface",
    border: "border-l-[3px] border-l-warm",
  },
  council: {
    label: "Council",
    dot: "bg-[hsl(150_14%_42%)]",
    bg: "bg-[hsl(150_10%_88%)]",
    border: "border-l-[3px] border-l-[hsl(150_14%_42%)]",
  },
  library: {
    label: "Library",
    dot: "bg-[hsl(350_42%_55%)]",
    bg: "bg-[hsl(350_34%_91%)]",
    border: "border-l-[3px] border-l-[hsl(350_42%_55%)]",
  },
  other: {
    label: "Other",
    dot: "bg-ink-mute",
    bg: "bg-surface-alt",
    border: "border-l-[3px] border-l-ink-mute",
  },
};

export function providerCategoryStyle(
  category: ProviderCategory,
): ProviderCategoryStyle {
  return PROVIDER_CATEGORY_STYLES[category] ?? PROVIDER_CATEGORY_STYLES.other;
}
