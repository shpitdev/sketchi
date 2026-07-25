import type { ReactNode } from "react";

import { BrandIcon } from "../brand-icon/index.js";

interface Feature {
  description: string;
  glyph: ReactNode;
  title: string;
}

const clusterIcons = [
  { label: "PostgreSQL", src: "/brand/postgresql.svg" },
  { label: "Cloudflare", src: "/brand/cloudflare.svg" },
  { label: "React", src: "/brand/react.svg" },
  { label: "Docker", src: "/brand/docker.svg" },
];

const features: readonly Feature[] = [
  {
    description:
      "Every shape, connector, and label stays editable after generation.",
    glyph: <ShapesGlyph />,
    title: "Real objects, not screenshots",
  },
  {
    description:
      "Find the tools in your stack without drawing their marks by hand.",
    glyph: (
      <span className="feature-card__cluster" aria-hidden="true">
        {clusterIcons.map((icon) => (
          <BrandIcon
            key={icon.src}
            label={icon.label}
            size={26}
            src={icon.src}
            tile
          />
        ))}
      </span>
    ),
    title: "1,400+ logos, already drawn",
  },
  {
    description:
      "Open the scene in Excalidraw, then export it when you are ready.",
    glyph: <ExportGlyph />,
    title: "Yours to edit and export",
  },
];

/**
 * Three icon-led benefits with one supporting sentence each.
 */
export function FeatureGrid() {
  return (
    <section className="sk-section feature-grid" id="product">
      <div className="sk-shell">
        <h2 className="sk-section__title feature-grid__title">
          Diagrams that behave like diagrams.
        </h2>
        <div className="feature-grid__cards">
          {features.map((feature) => (
            <article className="feature-card" key={feature.title}>
              {feature.glyph}
              <h3 className="feature-card__title">{feature.title}</h3>
              <p className="feature-card__description">{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShapesGlyph() {
  return (
    <span className="feature-card__glyph">
      <svg
        aria-hidden="true"
        fill="none"
        height="30"
        viewBox="0 0 30 30"
        width="30"
      >
        <rect
          height="9"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.7"
          width="12"
          x="2.5"
          y="3.5"
        />
        <path
          d="M8.5 12.5V17a2 2 0 0 0 2 2h6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path
          d="M22 15.5l4.5 4.5-4.5 4.5-4.5-4.5z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    </span>
  );
}

function ExportGlyph() {
  return (
    <span className="feature-card__glyph">
      <svg
        aria-hidden="true"
        fill="none"
        height="30"
        viewBox="0 0 30 30"
        width="30"
      >
        <path
          d="M6 12v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V12"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path
          d="M15 18V4M15 4l-4.5 4.5M15 4l4.5 4.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    </span>
  );
}
