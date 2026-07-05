import type { CSSProperties } from "react";

import { BrandIcon } from "../brand-icon/index.js";
import { agentSetupEntries } from "../agent-setup-view/index.js";

/**
 * Home-page band that shows the coding agents Sketchi plugs into, each with
 * its real brand icon, linking to that agent's setup page.
 */
export function AgentStrip() {
  return (
    <section className="sk-section agent-strip" id="agents">
      <div className="sk-shell">
        <div className="agent-strip__head">
          <p className="sk-eyebrow">Works where you work</p>
          <h2 className="sk-section__title">
            Ask your coding agent for a diagram.
          </h2>
          <p className="sk-section__lead">
            Sketchi plugs into the agents you already code with. Describe a
            system in chat and get a real, editable diagram back — no
            context-switching.
          </p>
        </div>

        <ul className="agent-strip__grid" aria-label="Supported coding agents">
          {agentSetupEntries.map((entry) => (
            <li key={entry.id}>
              <a
                className="agent-tile"
                href={entry.href}
                style={{ "--tile-accent": entry.accent } as CSSProperties}
              >
                <BrandIcon label={entry.name} size={34} src={entry.icon} tile />
                <span className="agent-tile__name">{entry.name}</span>
                <span className="agent-tile__tag">{entry.tagline}</span>
                <span className="agent-tile__cta" aria-hidden="true">
                  Set up →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
