"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";
import { diffExtractionFields } from "@/lib/extraction-diff";
import { useCreateEvent, useExtractEvent } from "@/lib/queries/events";
import type {
  ExperimentInfo,
  ExtractionInputType,
  ParentEvent,
} from "@/lib/types/events";
import EventForm from "./event-form";
import ExtractMessage, { type CaptureImage } from "./extract-message";
import ExtractingDialog from "./extracting-dialog";

// Inlined NEXT_PUBLIC_* at build time. Gates the funnel captures so a build
// without a PostHog key stays silent instead of warning on every extract.
const PH_ENABLED = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Capture and form share a persistent split: the form sits beside the capture
// box and is editable throughout (manual entry is just typing into it).
// "extracting" is the in-flight state — capture stays put under a loading
// dialog; "review" widens the form column around the extracted draft.
type Phase = "capture" | "extracting" | "review";

// The draft + assigned arm from the last extraction, kept together so the
// create handler can diff what the user submitted against what the model
// produced (the per-field edit-rate metric). Null in manual entry.
type Extraction = {
  draft: ParentEvent;
  experiment: ExperimentInfo | null;
  inputType: ExtractionInputType;
};

// Which fields the model populated → drives the sage dots in the review form.
function extractedFields(
  draft: ParentEvent | null,
): Partial<Record<keyof ParentEvent, boolean>> {
  if (!draft) return {};
  return {
    title: !!draft.title,
    event_type: draft.event_type !== "other",
    start_time: !!draft.start_time,
    end_time: !!draft.end_time,
    location: !!draft.location,
    description: !!draft.description,
    action_items: draft.action_items.length > 0,
  };
}

export default function EventExtraction() {
  const router = useRouter();
  const posthog = usePostHog();

  const extractMutation = useExtractEvent();
  const createMutation = useCreateEvent();

  // Cancelling an in-flight extract can't abort the request, so guard the
  // success/error handlers from yanking the user back out of "capture".
  const cancelledRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("capture");
  const [rawText, setRawText] = useState("");
  const [image, setImage] = useState<CaptureImage | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  // EventForm initializes its field state from `initial` once; bumping the key
  // remounts it so a new draft (or a fresh manual form) loads cleanly.
  const [formKey, setFormKey] = useState(0);

  function handleExtract() {
    const text = rawText.trim();
    if (!image && text.length < 10) {
      toast.error("Paste at least 10 characters of text");
      return;
    }
    const inputType: ExtractionInputType = image ? (text ? "text+image" : "image") : "text";
    cancelledRef.current = false;
    setPhase("extracting");
    // Errors (incl. a 429 quota hit → sign-up CTA) also surface in
    // useExtractEvent's onError; here we only handle UI phase + success wiring.
    extractMutation.mutate(
      { rawText: text || undefined, imageDataUrl: image?.dataUrl },
      {
        onSuccess: (res) => {
          if (cancelledRef.current) return;
          // Exposure: the draft is now on screen. Stash it (pre-edit) + the
          // arm so the create handler can compute the edit diff against it.
          setExtraction({ draft: res.event, experiment: res.experiment, inputType });
          setFormKey((k) => k + 1);
          setPhase("review");
          if (PH_ENABLED) {
            posthog.capture("extraction_shown", {
              variant: res.experiment?.variant,
              provider: res.experiment?.provider,
              model: res.experiment?.model,
              input_type: inputType,
            });
          }
        },
        onError: () => {
          if (!cancelledRef.current) setPhase("capture");
        },
      },
    );
  }

  function handleCancelExtract() {
    cancelledRef.current = true;
    setPhase("capture");
  }

  function handleDiscard() {
    setExtraction(null);
    // The form stays on screen in the capture phase — remount it so the
    // discarded draft's values don't linger in the empty disabled form.
    setFormKey((k) => k + 1);
    setPhase("capture");
  }

  function handleCreate(submitted: ParentEvent) {
    createMutation.mutate(submitted, {
      onSuccess: () => {
        // Conversion + primary metric: only when this event came from an
        // extraction (manual entries have no draft to diff against).
        if (PH_ENABLED && extraction) {
          const editedFields = diffExtractionFields(extraction.draft, submitted);
          posthog.capture("extraction_accepted", {
            variant: extraction.experiment?.variant,
            provider: extraction.experiment?.provider,
            model: extraction.experiment?.model,
            input_type: extraction.inputType,
            n_edited: editedFields.length,
            edited_fields: editedFields,
          });
        }
        router.push("/events");
        router.refresh();
      },
    });
  }

  const fromExtraction = !!extraction;
  // After a successful extraction the source rail shrinks and the form takes
  // the wide column; until then both halves share the row 50/50.
  const showSplit = phase === "review" && fromExtraction;

  return (
    <>
      <ExtractingDialog
        open={phase === "extracting"}
        rawText={rawText}
        image={image}
        onCancel={handleCancelExtract}
      />

      <div className="flex w-full flex-col gap-7 md:flex-row md:items-start md:gap-0">
        <div
          className={`w-full min-w-0 transition-all duration-500 ease-in-out ${
            showSplit ? "md:w-[30%]" : "md:w-1/2"
          }`}
        >
          <ExtractMessage
            variant={showSplit ? "extracted" : "active"}
            rawText={rawText}
            onRawTextChange={setRawText}
            image={image}
            onImageChange={setImage}
            onExtract={handleExtract}
            onEditSource={() => setPhase("capture")}
          />
        </div>

        <div
          className={`w-full min-w-0 transition-all duration-500 ease-in-out md:pl-7 ${
            showSplit ? "md:w-[70%]" : "md:w-1/2"
          }`}
        >
          <EventForm
            key={formKey}
            variant={createMutation.isPending ? "loading" : "active"}
            initial={extraction?.draft ?? null}
            extracted={extractedFields(extraction?.draft ?? null)}
            fromExtraction={fromExtraction}
            onSubmit={handleCreate}
            onDiscard={handleDiscard}
          />
        </div>
      </div>
    </>
  );
}
