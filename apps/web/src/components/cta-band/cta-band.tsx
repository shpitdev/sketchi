import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface CtaBandProps {
  /** Link to the no-signup playground. */
  playgroundHref?: string;
  /** Link to the agent setup hub. */
  agentsHref?: string;
}

/**
 * Closing call to action — one clear next step, framed for the reader.
 */
export function CtaBand({
  playgroundHref = DEFAULT_WEB_SURFACE_URLS.playground,
  agentsHref = "/agents",
}: CtaBandProps) {
  return (
    <section className="cta-band">
      <div className="sk-shell cta-band__inner">
        <p className="sk-eyebrow cta-band__eyebrow">Try it now</p>
        <h2 className="cta-band__title">Start with a sentence.</h2>
        <p className="cta-band__lead">
          No sign-up. Type what you want to see and watch it become a diagram
          you can edit.
        </p>
        <div className="cta-band__actions">
          <a className="sk-btn sk-btn--accent" href={playgroundHref}>
            Open the playground
          </a>
          <a className="sk-btn sk-btn--ghost cta-band__ghost" href={agentsHref}>
            Add to your agent
          </a>
        </div>
      </div>
    </section>
  );
}
