"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { uploadProviderCover } from "@/lib/queries/providers";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** Drag-and-drop (or click-to-browse) cover-image uploader. Owns the upload +
 *  its loading/error state; the parent just holds the resulting URL via onChange. */
export default function CoverDropzone({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Please choose a PNG, JPEG, or WebP image.");
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadProviderCover(file)); // also enforces the 5 MB cap
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Cover image</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) handleFile(e.dataTransfer.files?.[0]);
        }}
        disabled={uploading}
        className={`relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed text-center transition-colors disabled:opacity-70 ${
          dragging
            ? "border-primary bg-primary/5"
            : "border-input bg-surface hover:border-primary"
        }`}
      >
        {value && (
          <Image
            src={value}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 576px"
            className="object-cover"
          />
        )}
        {/* pointer-events-none so drag enter/leave only fire on the button
            itself (no flicker as the cursor moves over these children). */}
        <div className="pointer-events-none relative flex flex-col items-center gap-2 px-4">
          {!value && (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-ink-soft">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </span>
          )}
          <span
            className={
              value
                ? "rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm"
                : "text-sm text-ink-soft"
            }
          >
            {uploading
              ? "Uploading…"
              : value
                ? "Drag a new image here, or click to replace"
                : "Drag an image here, or click to browse"}
          </span>
          {!value && (
            <span className="text-xs text-muted-foreground">
              PNG, JPEG, or WebP · up to 5 MB
            </span>
          )}
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
