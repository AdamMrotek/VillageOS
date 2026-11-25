"use client";

import { useState } from "react";
import { toast } from "sonner";
import CoverDropzone from "@/components/cover-dropzone";
import PageLayout from "@/components/page-layout";
import { CATEGORY_LABELS, KIND_LABELS } from "@/components/provider-card";
import { useMyProvider, useUpdateMyProvider } from "@/lib/queries/providers";
import type {
  ProviderCategory,
  ProviderKind,
  StoredProviderProfile,
} from "@/lib/types/providers";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ProviderCategory[];

// How parents will use the page; shown under each option.
const KIND_HINTS: Record<ProviderKind, string> = {
  organiser: "You run events: classes, clubs, fairs. Schools and councils too.",
  venue: "A place families go: soft play, a pool, a library.",
  entertainer: "Booked for parties: a magician, a face painter, a party host.",
};
const KINDS = Object.keys(KIND_HINTS) as ProviderKind[];

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ProviderPage() {
  const { data: profile, isLoading } = useMyProvider();

  return (
    <PageLayout title="My provider page">
      {isLoading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        // `profile` is loaded once; the form initializes its state from it.
        <ProviderForm initial={profile ?? null} />
      )}
    </PageLayout>
  );
}

function ProviderForm({ initial }: { initial: StoredProviderProfile | null }) {
  const update = useUpdateMyProvider();

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<ProviderCategory>(
    initial?.category ?? "school",
  );
  const [kind, setKind] = useState<ProviderKind>(
    initial?.kind ?? "organiser",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? null);
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate(
      {
        name: name.trim(),
        category,
        kind,
        description: description.trim() || null,
        location: location.trim() || null,
        website: website.trim() || null,
        image_url: imageUrl,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      { onSuccess: () => toast.success("Your provider page is saved.") },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <CoverDropzone value={imageUrl} onChange={setImageUrl} />

      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Organisation name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="category" className="text-sm font-medium">
          Category
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ProviderCategory)}
          className={inputClass}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What kind of provider are you?</legend>
        <p className="text-xs text-ink-soft">
          Decides where parents find you on Discover.
        </p>
        {KINDS.map((k) => (
          <label
            key={k}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              kind === k
                ? "border-primary bg-surface-alt"
                : "border-input bg-surface hover:bg-surface-alt"
            }`}
          >
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                {KIND_LABELS[k]}
              </span>
              <span className="block text-xs text-ink-soft">
                {KIND_HINTS[k]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={600}
          rows={4}
          className={`${inputClass} h-auto`}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="location" className="text-sm font-medium">
          Location
        </label>
        <input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="website" className="text-sm font-medium">
          Website
        </label>
        <input
          id="website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://…"
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="tags" className="text-sm font-medium">
          Tags
        </label>
        <input
          id="tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="comma, separated, tags"
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={update.isPending}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {update.isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
