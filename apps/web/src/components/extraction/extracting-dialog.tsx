"use client";

import type { CaptureImage } from "./extract-message";

// Modal shown while the extractor reads the message: collapsed source bar +
// field skeletons over a dimmed backdrop. Cancel is the only way out — the
// capture card stays put underneath so dismissing lands you back where you were.
export default function ExtractingDialog({
  open,
  rawText,
  image,
  onCancel,
}: {
  open: boolean;
  rawText: string;
  image: CaptureImage | null;
  onCancel: () => void;
}) {
  if (!open) return null;

  const sourcePreview = rawText.trim();
  const meta = [
    sourcePreview ? `${sourcePreview.length} chars` : null,
    image ? "1 photo" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Extracting event"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div aria-hidden className="absolute inset-0 bg-ink/30" />

      <div className="relative w-full max-w-lg rounded-2xl border border-hairline bg-surface p-7 shadow-lg">
        {/* Collapsed source */}
        <div className="mb-6 flex items-center gap-3.5 rounded-xl border border-hairline bg-background px-4 py-3.5">
          <SourceThumb image={image} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-ink-soft">
              {sourcePreview || "Photo attached"}
            </p>
            {meta && <p className="mt-0.5 text-meta">{meta}</p>}
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-heading italic text-ink">Reading your message…</span>
          <span className="flex-1" />
          <span className="text-meta">usually ~3s</span>
        </div>

        <div className="grid grid-cols-[110px_1fr] items-center gap-x-6 gap-y-5">
          {[
            ["Title", "46%"],
            ["When", "34%"],
            ["Where", "52%"],
            ["To do", "64%"],
          ].map(([label, w]) => (
            <FieldLabelRow key={label} label={label} width={w} />
          ))}
        </div>

        <div className="mt-7 text-center">
          <button
            type="button"
            onClick={onCancel}
            className="text-meta underline-offset-4 hover:text-ink hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Hatched placeholder / thumbnail for the collapsed source bar.
function SourceThumb({
  image,
  className = "",
}: {
  image: { dataUrl: string } | null;
  className?: string;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image.dataUrl}
        alt="Attached source"
        className={`shrink-0 rounded object-cover ${className}`}
      />
    );
  }
  return (
    <div
      className={`shrink-0 rounded bg-surface-alt ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,0.05) 6px 12px)",
      }}
    />
  );
}

// One skeleton row in the extracting state.
function FieldLabelRow({ label, width }: { label: string; width: string }) {
  return (
    <>
      <span className="text-eyebrow">{label}</span>
      <span
        className="block h-3.5 animate-pulse rounded bg-surface-alt"
        style={{ width }}
      />
    </>
  );
}
