import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface CtaBandProps {
  /** Link to the no-signup playground. */
  playgroundHref?: string;
  /** Link to the agent setup hub. */
  agentsHref?: string;
  /** Link to the CLI section. */
  cliHref?: string;
}

/**
 * Closing invitation — a warm, blank sketch sheet echoing the hero board.
 * One clear next step, with the agent and terminal paths as quiet secondary
 * links for readers the browser is not the answer for.
 */
export function CtaBand({
  playgroundHref = DEFAULT_WEB_SURFACE_URLS.playground,
  agentsHref = "/agents",
  cliHref = "/#cli",
}: CtaBandProps) {
  return (
    <section className="cta-band">
      <div className="sk-shell">
        <div className="cta-band__sheet">
          <span className="cta-band__caret" aria-hidden="true" />
          <h2 className="cta-band__title">Start with a sentence.</h2>
          <p className="cta-band__lead">No sign-up. Just type it.</p>
          <div className="cta-band__actions">
            <a className="sk-btn sk-btn--accent" href={playgroundHref}>
              Open the playground
            </a>
            <a className="cta-band__link" href={agentsHref}>
              or add it to your coding agent →
            </a>
            <a className="cta-band__link" href={cliHref}>
              or install the CLI →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
