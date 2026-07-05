import type { ReactNode } from "react";

import { BrandIcon } from "../brand-icon/index.js";

interface Feature {
  body: string;
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
    body: "Every box, arrow, and label is a real shape you can drag, relabel, and restyle — never a flat picture you have to redraw from scratch.",
    glyph: <ShapesGlyph />,
    title: "Real objects, not screenshots",
  },
  {
    body: "Databases, clouds, frameworks, AI models — Sketchi drops in crisp brand logos so your architecture actually looks like your stack.",
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
    body: "Open any diagram on the canvas, adjust it by hand, and take it straight to your docs, your slides, or your pull request.",
    glyph: <ExportGlyph />,
    title: "Yours to edit and export",
  },
];

/**
 * Three benefit cards that reframe the product in the reader's terms —
 * no pipeline internals, no package names.
 */
export function FeatureGrid() {
  return (
    <section className="sk-section feature-grid" id="product">
      <div className="sk-shell">
        <div className="sk-section__head">
          <p className="sk-eyebrow">Why Sketchi</p>
          <h2 className="sk-section__title">
            Diagrams that behave like diagrams.
          </h2>
        </div>
        <div className="feature-grid__cards">
          {features.map((feature) => (
            <article className="feature-card" key={feature.title}>
              {feature.glyph}
              <h3 className="feature-card__title">{feature.title}</h3>
              <p className="feature-card__body">{feature.body}</p>
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
