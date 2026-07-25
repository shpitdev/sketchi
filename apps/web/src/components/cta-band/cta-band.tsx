import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface CtaBandProps {
  /** Link to the no-signup playground. */
  playgroundHref?: string;
  /** Link to the agent setup hub. */
  agentsHref?: string;
}

/**
 * Closing invitation — a warm, blank sketch sheet echoing the hero board.
 * One clear next step, and one quiet alternative for readers the browser is
 * not the answer for. The CLI has its own section above.
 */
export function CtaBand({
  playgroundHref = DEFAULT_WEB_SURFACE_URLS.playground,
  agentsHref = "/agents",
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
          </div>
        </div>
      </div>
    </section>
  );
}
