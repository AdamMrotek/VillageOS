"use client";

import { useState } from "react";
import type { GoldenCase } from "@/lib/evals/types";
import { GoldenImage } from "./GoldenImage";

/** One golden case as a collapsible row inside the shared golden-set card: the
 *  header (case id + kind) is always visible with a chevron on the right;
 *  clicking it reveals the input the model sees and the partial expected spec it's
 *  graded against. Rows are divided by a hairline by the parent container. */
export function GoldenCaseCard({ c }: { c: GoldenCase }) {
  const [open, setOpen] = useState(false);
  const panelId = `golden-${c.case_id}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-baseline gap-3 px-6 py-4 text-left hover:bg-surface-alt"
      >
        <h2 className="text-sm font-medium text-mono">{c.case_id}</h2>
        {c.has_image && (
          <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] bg-warm-surface text-warm">
            Vision
          </span>
        )}
        <span
          className={`ml-auto self-center text-ink-mute transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div id={panelId} className="px-6 pb-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-6">
              {c.has_image && (
                <div>
                  <div className="text-eyebrow mb-2">Input image</div>
                  <GoldenImage caseId={c.case_id} />
                </div>
              )}
              <div>
                <div className="text-eyebrow mb-2">
                  {c.has_image ? "Transcript" : "Input text"}
                </div>
                <pre className="max-h-96 overflow-auto rounded-lg border border-hairline bg-background px-4 py-3 text-xs text-ink-soft whitespace-pre-wrap break-words">
                  {c.input_text || "—"}
                </pre>
              </div>
            </div>
            <div>
              <div className="text-eyebrow mb-2">Expected result</div>
              <pre className="max-h-96 overflow-auto rounded-lg border border-hairline bg-background px-4 py-3 text-xs text-mono text-ink-soft whitespace-pre-wrap break-words">
                {JSON.stringify(c.expected, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
