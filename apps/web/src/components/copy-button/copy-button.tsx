import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  value: string;
  /** What is being copied, for the accessible label (e.g. "Verify command"). */
  label?: string;
}

/**
 * Zero-friction copy control for a command or config snippet: one click writes
 * to the clipboard and flips to a brief "Copied" state. Sits in the corner of
 * a `.code-snippet` and matches the mono sketch aesthetic.
 */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      aria-label={copied ? "Copied" : label ? `Copy ${label}` : "Copy"}
      className="copy-btn"
      data-copied={copied ? "" : undefined}
      onClick={copy}
      type="button"
    >
      <span aria-hidden="true" className="copy-btn__glyph">
        {copied ? <CheckGlyph /> : <ClipboardGlyph />}
      </span>
      <span className="copy-btn__text">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ClipboardGlyph() {
  return (
    <svg fill="none" height="14" viewBox="0 0 16 16" width="14">
      <rect
        height="10"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="1.4"
        width="8"
        x="5"
        y="4.5"
      />
      <path
        d="M5 3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 11 3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
