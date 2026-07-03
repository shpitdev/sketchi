import { useState } from "react";

import {
  formatBytes,
  formatCollectionLabel,
  type SketchiIcon,
} from "../../lib/icon-data.js";

export interface IconDetailProps {
  icon: SketchiIcon;
  onClose?: () => void;
}

type CopyState = "copied" | "error" | "idle";

export function IconDetail({ icon, onClose }: IconDetailProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [pathCopyState, setPathCopyState] = useState<CopyState>("idle");

  async function copySvg() {
    try {
      const response = await fetch(icon.urlPath);
      if (!response.ok) {
        throw new Error(`Icon SVG returned HTTP ${response.status}.`);
      }
      const markup = await response.text();
      await navigator.clipboard.writeText(markup);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(icon.urlPath);
      setPathCopyState("copied");
    } catch {
      setPathCopyState("error");
    }
  }

  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Copy failed"
        : "Copy SVG";
  const pathCopyLabel =
    pathCopyState === "copied"
      ? "Path copied"
      : pathCopyState === "error"
        ? "Path failed"
        : "Copy path";

  return (
    <section className="icon-detail" aria-label={`${icon.slug} details`}>
      <header className="icon-detail__head">
        <div>
          <p className="icon-detail__eyebrow">
            {formatCollectionLabel(icon.collection)}
          </p>
          <h2 className="icon-detail__slug">{icon.slug}</h2>
        </div>
        {onClose ? (
          <button
            aria-label="Close details"
            className="icon-detail__close"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="18"
              viewBox="0 0 18 18"
              width="18"
            >
              <path
                d="M4 4l10 10M14 4L4 14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.7"
              />
            </svg>
          </button>
        ) : null}
      </header>

      <div className="icon-detail__preview">
        <img alt={`${icon.slug} icon, large preview`} src={icon.urlPath} />
      </div>

      <dl className="icon-detail__meta">
        <div>
          <dt>File</dt>
          <dd>{icon.fileName}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(icon.bytes)}</dd>
        </div>
        {icon.viewBox ? (
          <div>
            <dt>viewBox</dt>
            <dd>
              {icon.viewBox.width}×{icon.viewBox.height}
            </dd>
          </div>
        ) : null}
        {icon.variant ? (
          <div>
            <dt>Variant</dt>
            <dd>{icon.variant}</dd>
          </div>
        ) : null}
        {icon.similarityGroupSize && icon.similarityGroupSize > 1 ? (
          <div>
            <dt>Similar</dt>
            <dd>{icon.similarityGroupSize} in group</dd>
          </div>
        ) : null}
      </dl>

      {icon.flags.length > 0 ? (
        <div className="icon-detail__flags" aria-label="Review flags">
          {icon.flags.map((flag) => (
            <span className="icon-detail__flag" key={flag}>
              {flag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="icon-detail__actions">
        <button
          className="icon-detail__btn icon-detail__btn--primary"
          onClick={copySvg}
          type="button"
        >
          {copyLabel}
        </button>
        <a
          className="icon-detail__btn"
          download={icon.fileName}
          href={icon.urlPath}
        >
          Download
        </a>
        <button className="icon-detail__btn" onClick={copyPath} type="button">
          {pathCopyLabel}
        </button>
      </div>
      <p className="icon-detail__copy-status" aria-live="polite">
        {copyState === "copied" || pathCopyState === "copied"
          ? "Copied to clipboard."
          : copyState === "error" || pathCopyState === "error"
            ? "Clipboard copy failed."
            : ""}
      </p>
    </section>
  );
}
