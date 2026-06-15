"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { downscaleImageToDataUrl } from "@/lib/image-downscale";
import { useIsDemo } from "@/lib/hooks/use-is-demo";
import ShowMoreText from "@/components/show-more-text";

// The attached photo as it lives in the capture flow: downscaled to JPEG in
// the browser and sent inline — never uploaded to storage (see
// lib/image-downscale.ts).
export type CaptureImage = { dataUrl: string; bytes: number; name: string };

// "active" is the editable capture card; "extracted" the collapsed read-only
// source panel shown beside the review form, with edit / re-extract actions.
// The in-flight loading state lives in ExtractingDialog, not here.
export type ExtractMessageVariant = "active" | "extracted";

// Clickable starter prompts — fill the box with a representative sample so the
// extractor has something real to chew on in a demo.
const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "A WhatsApp reminder",
    text: "Hi all! Just a reminder the Summer Bake Sale is this Friday 24th at 3pm in the school hall. Please bring £2 in a labelled envelope. Cake donations very welcome — drop them at the office on Thursday. Sarah x",
  },
  {
    label: "A school newsletter",
    text: "Dear Parents, Year 3 will be visiting the Natural History Museum on Tuesday 8th July. The coach leaves at 8:45am sharp. Please return the signed consent form and £12 by Friday 27th June.",
  },
  {
    label: "A party invite",
    text: "You're invited! Leo turns 6 🎉 Saturday 14th June, 2–4pm at Clip 'n Climb, Bristol. Please RSVP to Mum by 7th June.",
  },
];

type ExtractMessageProps = {
  variant: ExtractMessageVariant;
  rawText: string;
  onRawTextChange: (text: string) => void;
  image: CaptureImage | null;
  onImageChange: (image: CaptureImage | null) => void;
  // Also serves as "Re-extract" in the extracted variant.
  onExtract: () => void;
  // Extracted variant only: back to the editable capture card.
  onEditSource: () => void;
};

export default function ExtractMessage({
  variant,
  rawText,
  onRawTextChange,
  image,
  onImageChange,
  onExtract,
  onEditSource,
}: ExtractMessageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Starter examples are an onboarding aid — only surface them in the demo.
  const { data: isDemo } = useIsDemo();

  async function ingestImageFile(file: File) {
    try {
      const downscaled = await downscaleImageToDataUrl(file);
      onImageChange({ ...downscaled, name: file.name || "pasted-screenshot.png" });
    } catch {
      toast.error("Couldn't read that image — try a JPEG or PNG, or a screenshot.");
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    e.target.value = "";
    if (file) await ingestImageFile(file);
  }

  // Paste a screenshot straight onto the capture box (⌘V). Text paste falls
  // through untouched — we only intercept when the clipboard carries an image.
  async function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await ingestImageFile(file);
  }

  if (variant === "extracted") {
    return (
      <ExtractedSourceView
        rawText={rawText}
        image={image}
        onEditSource={onEditSource}
        onReExtract={onExtract}
      />
    );
  }

  const ready = !!image || rawText.trim().length >= 10;

  return (
    <div className="w-full">
      <div className="space-y-2">
        <p className="text-eyebrow-accent">AI extraction</p>
        <h2 className="text-heading text-ink">Paste text or add a photo</h2>
        <p className="max-w-[480px] text-pretty text-meta">
          WhatsApp thread, school newsletter, email, or a photo of a flyer —
          anything with an event.
        </p>
      </div>

      {/* Unified capture card: text + photo feed the same extractor */}
      <div
        className={`mt-7 overflow-hidden rounded-2xl bg-surface shadow-sm ${
          image ? "border border-hairline" : "border border-dashed border-hairline"
        }`}
      >
        <textarea
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          onPaste={handlePaste}
          rows={image ? 4 : 7}
          maxLength={8000}
          placeholder="Paste text, or drag / paste a photo onto this box…"
          className="w-full resize-none border-0 bg-transparent px-6 py-5 text-body leading-relaxed text-ink placeholder:text-ink-mute/70 focus-visible:outline-none"
        />

        {image && (
          <div className="flex gap-2.5 px-6 pb-4">
            <div className="inline-flex items-center gap-2.5 rounded-lg border border-hairline bg-background p-1.5 pr-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt="Attached leaflet or screenshot"
                className="h-11 w-11 rounded object-cover"
              />
              <div className="min-w-0">
                <p className="truncate text-body text-ink">{image.name}</p>
                <p className="text-meta">
                  ~{Math.max(1, Math.round(image.bytes / 1024))} KB
                </p>
              </div>
              <button
                type="button"
                onClick={() => onImageChange(null)}
                aria-label="Remove photo"
                className="ml-1 text-ink-mute hover:text-destructive"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Footer bar */}
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-meta font-medium text-ink-soft hover:border-accent hover:text-ink"
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-ink-mute text-[10px] leading-none text-ink-mute">
              +
            </span>
            Add a photo
          </button>
          <span className="text-meta text-ink-mute">or paste a screenshot</span>
          <span className="flex-1" />
          <span className="text-meta tabular-nums">{rawText.length} / 8000</span>
          <button
            type="button"
            onClick={onExtract}
            disabled={!ready}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-5 text-body font-medium text-accent-foreground shadow hover:bg-accent-dark disabled:pointer-events-none disabled:opacity-50"
          >
            Extract event →
          </button>
        </div>
      </div>

      {!image && isDemo && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-meta uppercase tracking-wide text-ink-mute">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => onRawTextChange(ex.text)}
              className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-meta text-ink-soft hover:border-accent hover:text-ink"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}

    </div>
  );
}

// The "extracted" variant: the review rail showing what the extraction read
// from, with the escape hatches back into the capture flow.
function ExtractedSourceView({
  rawText,
  image,
  onEditSource,
  onReExtract,
}: {
  rawText: string;
  image: CaptureImage | null;
  onEditSource: () => void;
  onReExtract: () => void;
}) {
  const sourcePreview = rawText.trim();
  return (
    <aside className="rounded-2xl border border-hairline bg-surface p-5">
      <p className="text-eyebrow mb-3.5">Source</p>
      {sourcePreview && (
        <blockquote className="mb-4 border-l-2 border-accent-soft pl-3.5">
          <ShowMoreText text={sourcePreview} lines={4} className="text-body-soft italic" />
        </blockquote>
      )}
      {image && (
        <div className="flex items-center gap-2.5 rounded-lg border border-hairline bg-background p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt="Attached leaflet or screenshot"
            className="h-9 w-9 shrink-0 rounded object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-body text-ink">{image.name}</p>
            <p className="text-meta">read for date + venue</p>
          </div>
        </div>
      )}
      <div className="mt-4 flex gap-4 border-t border-hairline pt-4">
        <button
          type="button"
          onClick={onEditSource}
          className="text-meta font-medium text-accent-dark hover:underline"
        >
          Edit source
        </button>
        <button
          type="button"
          onClick={onReExtract}
          className="text-meta font-medium text-accent-dark hover:underline"
        >
          Re-extract
        </button>
      </div>
    </aside>
  );
}
