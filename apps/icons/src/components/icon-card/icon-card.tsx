import {
  formatCollectionLabel,
  type SketchiIcon,
} from "../../lib/icon-data.js";

export interface IconCardProps {
  readonly active?: boolean;
  readonly copied?: boolean;
  readonly copying?: boolean;
  readonly icon: SketchiIcon;
  readonly onCopy?: (icon: SketchiIcon) => void;
  readonly onDetails?: (icon: SketchiIcon) => void;
  readonly onToggleSelected?: (icon: SketchiIcon) => void;
  readonly previewMode?: "dark" | "light";
  readonly selected?: boolean;
}

export function IconCard({
  active = false,
  copied = false,
  copying = false,
  icon,
  onCopy,
  onDetails,
  onToggleSelected,
  previewMode = "light",
  selected = false,
}: IconCardProps) {
  return (
    <article
      className="icon-card"
      data-active={active ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <button
        aria-label={`Copy ${icon.name} SVG`}
        aria-describedby={`icon-meta-${icon.slug}`}
        className="icon-card__copy"
        id={`icon-result-${icon.slug}`}
        onClick={() => onCopy?.(icon)}
        type="button"
      >
        <span className="icon-card__preview" data-preview={previewMode}>
          <img alt="" loading="lazy" src={icon.svgPath} />
          <span className="icon-card__copy-cue">
            {copying ? "Copying" : copied ? "Copied" : "Copy SVG"}
          </span>
        </span>
        <span className="icon-card__name">{icon.name}</span>
        <span className="icon-card__collection" id={`icon-meta-${icon.slug}`}>
          {formatCollectionLabel(icon.collection)}
        </span>
      </button>
      <div className="icon-card__actions">
        <button
          aria-label={`${selected ? "Remove" : "Add"} ${icon.name} ${
            selected ? "from" : "to"
          } selection`}
          aria-pressed={selected}
          className="icon-card__select"
          onClick={() => onToggleSelected?.(icon)}
          type="button"
        >
          {selected ? "Selected" : "Select"}
        </button>
        <button
          aria-label={`View ${icon.name} details`}
          className="icon-card__details"
          onClick={() => onDetails?.(icon)}
          type="button"
        >
          Details
        </button>
      </div>
    </article>
  );
}
