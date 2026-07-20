"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-fetch";
import { createClient } from "@repo/ui/lib/supabase";
import { useIsDemo } from "@/lib/hooks/use-is-demo";
import { useCreateEvent, useExtractEvent } from "@/lib/queries/events";
import type { ExtractionInputType, ParentEvent } from "@/lib/types/events";
import EventForm from "./event-form";
import ExtractMessage, { type CaptureImage } from "./extract-message";
import ExtractingDialog from "./extracting-dialog";

// Capture and form share a persistent split: the form sits beside the capture
// box and is editable throughout (manual entry is just typing into it).
// "extracting" is the in-flight state — capture stays put under a loading
// dialog; "review" widens the form column around the extracted draft.
type Phase = "capture" | "extracting" | "review";

// The draft from the last extraction, kept so the review form can seed its
// fields from it. Null in manual entry.
type Extraction = {
  draft: ParentEvent;
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

  const extractMutation = useExtractEvent();
  const createMutation = useCreateEvent();
  const { data: isDemo } = useIsDemo();

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

  // The daily-quota (429) message. Copy + CTA differ by account type: demo
  // accounts are nudged to create a real account, free accounts to Pro.
  const limitToast = isDemo
    ? {
        message: "Demo limit reached — create a free account to keep going.",
        cta: "Create account",
        href: "/sign-up",
        // End the anonymous demo session before sending them to sign-up.
        signOut: true,
      }
    : {
        message: "Daily limit reached — upgrade for more.",
        cta: "Upgrade to Pro",
        // TODO: point at the billing/upgrade flow once it exists.
        href: "/settings",
        signOut: false,
      };

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
          // The draft is now on screen; stash it so the review form seeds from it.
          setExtraction({ draft: res.event, inputType });
          setFormKey((k) => k + 1);
          setPhase("review");
        },
        onError: (error) => {
          if (cancelledRef.current) return;
          setPhase("capture");
          if (error instanceof ApiError && error.status === 429) {
            // White (default) variant, sticky — stays until dismissed.
            // Widen past sonner's default 356px via the per-toast --width var.
            toast(limitToast.message, {
              id: "extract-limit",
              duration: Infinity,
              style: { "--width": "440px" } as React.CSSProperties,
              action: {
                label: limitToast.cta,
                onClick: async () => {
                  if (limitToast.signOut) {
                    await createClient().auth.signOut();
                  }
                  window.location.href = limitToast.href;
                },
              },
            });
          }
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
        router.push("/calendar");
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
