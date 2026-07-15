import type { ReactNode } from "react";

import { BrandIcon } from "../brand-icon/index.js";
import { agentSetupEntries } from "../agent-setup-view/index.js";
import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface PathForkProps {
  agentsHref?: string;
  surfaceUrls?: WebSurfaceUrls;
}

/**
 * The fork: one decision — use Sketchi yourself in the playground, or hand it
 * to the coding agent you already use. Two calm columns instead of stacked
 * cards, with the supported agents folded into the agent side so the whole
 * story lives in a single confident section.
 */
export function PathFork({
  agentsHref = "/agents",
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: PathForkProps) {
  return (
    <section aria-label="Two ways to use Sketchi" className="sk-section path-fork">
      <div className="sk-shell">
        <div className="sk-section__head">
          <h2 className="sk-section__title">Pick your path.</h2>
          <p className="sk-section__lead">
            Draw with Sketchi yourself in the playground, or hand it to the
            coding agent you already work in.
          </p>
        </div>

        <div className="path-fork__grid">
          <article className="path-lane">
            <span className="path-lane__glyph" aria-hidden="true">
              <HumanGlyph />
            </span>
            <h3 className="path-lane__title">Use it yourself</h3>
            <p className="path-lane__body">
              Open the playground and describe a diagram. Sketchi draws it, you
              edit and export. No sign-up.
            </p>
            <a
              className="sk-btn sk-btn--primary path-lane__cta"
              href={surfaceUrls.playground}
            >
              Open the playground
            </a>
          </article>

          <article className="path-lane path-lane--agent">
            <span className="path-lane__glyph" aria-hidden="true">
              <AgentGlyph />
            </span>
            <h3 className="path-lane__title">Plug it into your agent</h3>
            <p className="path-lane__body">
              Connect Sketchi once, then ask the agent you already code with for
              a real, editable diagram, right in your editor.
            </p>
            <ul className="path-lane__agents" aria-label="Supported coding agents">
              {agentSetupEntries.map((entry) => (
                <li key={entry.id}>
                  <a className="agent-chip" href={entry.href}>
                    {/* Icon is decorative — the chip text already names the agent. */}
                    <BrandIcon label="" size={20} src={entry.icon} />
                    <span className="agent-chip__name">{entry.name}</span>
                  </a>
                </li>
              ))}
            </ul>
            <a className="path-lane__link" href={agentsHref}>
              See every setup →
            </a>
          </article>
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
