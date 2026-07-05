import type { CSSProperties, ReactNode } from "react";

import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface PathForkProps {
  agentsHref?: string;
  surfaceUrls?: WebSurfaceUrls;
}

interface ForkPath {
  accent: string;
  body: string;
  cta: string;
  glyph: ReactNode;
  href: string;
  kicker: string;
  title: string;
}

/**
 * The fork: one decision — use Sketchi yourself in the playground, or hand it
 * to the coding agent you already use — drives everything else. Kept right
 * under the hero so the two paths are the first thing a visitor sees.
 */
export function PathFork({
  agentsHref = "/agents",
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: PathForkProps) {
  const paths: readonly ForkPath[] = [
    {
      accent: "var(--accent)",
      body: "Open the playground and describe a diagram. Sketchi draws it — you edit and export. No sign-up.",
      cta: "Open the playground",
      glyph: <HumanGlyph />,
      href: surfaceUrls.playground,
      kicker: "For people",
      title: "Use it yourself",
    },
    {
      accent: "var(--blueprint)",
      body: "Connect Sketchi once, then ask the agent you already code with for a diagram — a real, editable one, in your editor.",
      cta: "Add to your agent",
      glyph: <AgentGlyph />,
      href: agentsHref,
      kicker: "For coding agents",
      title: "Plug it into your agent",
    },
  ];

  return (
    <section aria-label="Two ways to use Sketchi" className="sk-section path-fork">
      <div className="sk-shell">
        <div className="sk-section__head">
          <p className="sk-eyebrow">Two ways in</p>
          <h2 className="sk-section__title">Pick your path.</h2>
          <p className="sk-section__lead">
            One choice sets everything else: draw with Sketchi yourself, or hand
            it to your coding agent.
          </p>
        </div>

        <div className="path-fork__grid">
          {paths.map((path) => (
            <article
              className="path-card"
              key={path.title}
              style={{ "--tile-accent": path.accent } as CSSProperties}
            >
              <span className="path-card__glyph" aria-hidden="true">
                {path.glyph}
              </span>
              <p className="path-card__kicker">{path.kicker}</p>
              <h3 className="path-card__title">{path.title}</h3>
              <p className="path-card__body">{path.body}</p>
              <a className="sk-btn sk-btn--primary path-card__cta" href={path.href}>
                {path.cta}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HumanGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="30"
      viewBox="0 0 30 30"
      width="30"
    >
      <path
        d="M8 5.5 20.5 11l-5.2 1.9L13.4 18z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M22 5.5l1.5 1.5M25 9.5l1.7.4M22.5 12.5l1.2 1.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function AgentGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="30"
      viewBox="0 0 30 30"
      width="30"
    >
      <path
        d="M5 7.5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M9.5 13l3 2.5-3 2.5M15 19h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}
