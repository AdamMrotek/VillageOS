"use client";

import { useEffect, useState } from "react";
import { adminGetBlob } from "@/lib/api";

/** A golden case's input image. The admin image endpoint needs a bearer header,
 *  which a plain <img src> can't send, so we fetch the bytes and render an object
 *  URL (revoked on unmount). */
export function GoldenImage({
  caseId,
  className = "max-h-72 rounded-lg border border-hairline",
}: {
  caseId: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    adminGetBlob(`/api/admin/evals/golden/${caseId}/image`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [caseId]);

  if (failed) {
    return <div className="text-meta text-cat-deadline">image unavailable</div>;
  }
  if (!url) {
    return <div className="text-meta">loading image…</div>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element -- src is an authed
          blob object URL; next/image's loader can't carry the bearer header. */}
      <img src={url} alt={`Golden input image for ${caseId}`} className={className} />
    </a>
  );
}
