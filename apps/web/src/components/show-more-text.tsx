"use client";

import { useLayoutEffect, useRef, useState } from "react";

type ShowMoreTextProps = {
  text: string;
  // How many lines to show before clamping.
  lines: number;
  // Styles the text element itself (font, color, etc.).
  className?: string;
};

// Clamps text to `lines` lines; when it overflows, a "Show more" toggle
// reveals the rest. Overflow is measured, so the button only appears when
// there genuinely is more to show.
export default function ShowMoreText({ text, lines, className = "" }: ShowMoreTextProps) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // While expanded nothing is clipped by definition — keep the last measured
    // value so the "Show less" button doesn't vanish.
    const check = () => {
      if (!el.style.webkitLineClamp) return;
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines, expanded]);

  return (
    <div>
      <p
        ref={textRef}
        className={`whitespace-pre-wrap ${className}`}
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {(clipped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-meta font-medium text-accent-dark hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
