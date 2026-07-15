import type { SketchiIcon } from "../../lib/icon-data.js";

export interface IconCardProps {
  active?: boolean;
  icon: SketchiIcon;
  onSelect?: (icon: SketchiIcon) => void;
}

export function IconCard({ active = false, icon, onSelect }: IconCardProps) {
  const flagged = icon.flags.length > 0;

  return (
    <button
      aria-pressed={active}
      className="icon-card"
      onClick={() => onSelect?.(icon)}
      type="button"
    >
      <span className="icon-card__preview">
        <img alt={`${icon.slug} icon`} loading="lazy" src={icon.urlPath} />
        {flagged ? (
          <span
            aria-label={`${icon.flags.length} review flag${
              icon.flags.length === 1 ? "" : "s"
            }`}
            className="icon-card__flag"
            title={icon.flags.join(", ")}
          />
        ) : null}
      </span>
      <span className="icon-card__slug">{icon.slug}</span>
      <span className="icon-card__collection">{icon.collection}</span>
    </button>
  );
}
