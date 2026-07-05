import type { ReactNode } from "react";

export type SurfaceStatus = "beta" | "live" | "preview";

export interface SurfaceCardProps {
  cta?: string;
  desc: string;
  domain: string;
  glyph?: ReactNode;
  href: string;
  name: string;
  status?: SurfaceStatus;
}

const statusCopy: Record<SurfaceStatus, string> = {
  beta: "Private beta",
  live: "Live",
  preview: "No-auth preview",
};

const statusDot: Record<SurfaceStatus, string> = {
  beta: "sk-pill__dot--accent",
  live: "sk-pill__dot--ok",
  preview: "sk-pill__dot--accent",
};

export function SurfaceCard({
  cta = "Open",
  desc,
  domain,
  glyph,
  href,
  name,
  status = "preview",
}: SurfaceCardProps) {
  return (
    <a className="surface-card" href={href}>
      <div className="surface-card__top">
        <span className="surface-card__glyph">{glyph ?? <DefaultGlyph />}</span>
        <span className="sk-pill">
          <span className={`sk-pill__dot ${statusDot[status]}`} />
          {statusCopy[status]}
        </span>
      </div>
      <span className="surface-card__domain">{domain}</span>
      <h3 className="surface-card__name">{name}</h3>
      <p className="surface-card__desc">{desc}</p>
      <span className="surface-card__foot">
        {cta} <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

function DefaultGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
    >
      <rect
        height="6"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        width="9"
        x="2"
        y="3"
      />
      <rect
        height="6"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        width="9"
        x="9"
        y="11"
      />
      <path
        d="M11 6h3.5a1.5 1.5 0 0 1 1.5 1.5V11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
