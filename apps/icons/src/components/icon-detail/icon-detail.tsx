import { useEffect, useRef } from "react";

import {
  formatBytes,
  formatCollectionLabel,
  type SketchiIcon,
} from "../../lib/icon-data.js";

export type IconDetailAction =
  | "copy-data-uri"
  | "copy-jsx"
  | "copy-svg"
  | "copy-url"
  | "download";

export interface IconDetailProps {
  readonly busyAction?: IconDetailAction;
  readonly icon: SketchiIcon;
  readonly onAction?: (action: IconDetailAction, icon: SketchiIcon) => void;
  readonly onClose?: () => void;
  readonly onPreviewModeChange?: (mode: "dark" | "light") => void;
  readonly permanentUrl: string;
  readonly previewMode?: "dark" | "light";
  readonly returnFocusTo?: HTMLElement | null;
}

const actionLabels: Readonly<Record<IconDetailAction, string>> = {
  "copy-data-uri": "Copy data URI",
  "copy-jsx": "Copy JSX",
  "copy-svg": "Copy SVG",
  "copy-url": "Copy URL",
  download: "Download SVG",
};

const detailActions: readonly IconDetailAction[] = [
  "copy-svg",
  "copy-url",
  "copy-jsx",
  "copy-data-uri",
  "download",
];

export function IconDetail({
  busyAction,
  icon,
  onAction,
  onClose,
  onPreviewModeChange,
  permanentUrl,
  previewMode = "light",
  returnFocusTo,
}: IconDetailProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [onClose, returnFocusTo]);

  return (
    <aside
      aria-label={`${icon.name} details`}
      aria-modal="true"
      className="icon-detail"
      ref={dialogRef}
      role="dialog"
    >
      <header className="icon-detail__head">
        <div>
          <p className="icon-detail__collection">
            {formatCollectionLabel(icon.collection)}
          </p>
          <h2>{icon.name}</h2>
        </div>
        <button
          aria-label="Close icon details"
          className="icon-detail__close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          Close
        </button>
      </header>

      <div className="icon-detail__preview" data-preview={previewMode}>
        <img alt={`${icon.name} preview`} src={icon.svgPath} />
      </div>

      <div className="preview-toggle" aria-label="Preview background">
        <span>Preview</span>
        <div className="preview-toggle__buttons">
          <button
            aria-pressed={previewMode === "light"}
            onClick={() => onPreviewModeChange?.("light")}
            type="button"
          >
            Light
          </button>
          <button
            aria-pressed={previewMode === "dark"}
            onClick={() => onPreviewModeChange?.("dark")}
            type="button"
          >
            Dark
          </button>
        </div>
      </div>

      <dl className="icon-detail__meta">
        <div>
          <dt>Dimensions</dt>
          <dd>
            {icon.viewBox.width} × {icon.viewBox.height}
          </dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>{formatBytes(icon.bytes)}</dd>
        </div>
        {icon.variant ? (
          <div>
            <dt>Style</dt>
            <dd>{icon.variant === "text" ? "Wordmark" : icon.variant}</dd>
          </div>
        ) : null}
      </dl>

      <div className="icon-detail__url">
        <span>Permanent SVG URL</span>
        <code>{permanentUrl}</code>
      </div>

      <div className="icon-detail__actions">
        {detailActions.map((action) => (
          <button
            className={action === "copy-svg" ? "is-primary" : undefined}
            disabled={busyAction !== undefined}
            key={action}
            onClick={() => onAction?.(action, icon)}
            type="button"
          >
            {busyAction === action ? "Working" : actionLabels[action]}
          </button>
        ))}
      </div>

      {icon.aliases.length ? (
        <p className="icon-detail__aliases">
          Also found by: {icon.aliases.join(", ")}
        </p>
      ) : null}
    </aside>
  );
}
