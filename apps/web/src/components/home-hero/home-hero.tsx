import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface HomeHeroProps {
  docsHref?: string;
  eyebrow?: string;
  lead?: string;
  primaryHref?: string;
}

export function HomeHero({
  docsHref = "/docs",
  eyebrow = "Typed diagram generation",
  lead = "Compile a prompt into typed, validated IR — then render deterministic, Excalidraw-ready scenes.",
  primaryHref = DEFAULT_WEB_SURFACE_URLS.excalidraw,
}: HomeHeroProps) {
  return (
    <section className="home-hero">
      <div className="sk-shell home-hero__inner">
        <div className="home-hero__copy">
          <p className="sk-eyebrow sk-rise" style={{ "--i": 0 } as never}>
            {eyebrow}
          </p>
          <h1
            className="home-hero__title sk-rise"
            style={{ "--i": 1 } as never}
          >
            Prompts become <em>validated diagrams.</em>
          </h1>
          <p className="home-hero__lead sk-rise" style={{ "--i": 2 } as never}>
            {lead}
          </p>
          <div
            className="home-hero__actions sk-rise"
            style={{ "--i": 3 } as never}
          >
            <a className="sk-btn sk-btn--primary" href={primaryHref}>
              Open the app
            </a>
            <a className="sk-btn sk-btn--ghost" href={docsHref}>
              Read the docs
            </a>
          </div>
          <dl className="home-hero__meta sk-rise" style={{ "--i": 4 } as never}>
            <div>
              <dt>Runtime</dt>
              <dd>Workers previews + production</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>Typed IR before layout</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>No-auth surfaces live</dd>
            </div>
          </dl>
        </div>

        <div
          className="home-hero__visual sk-rise"
          style={{ "--i": 2 } as never}
        >
          <div className="hero-frame">
            <div className="hero-frame__bar">
              <span className="hero-frame__dots">
                <span />
                <span />
                <span />
              </span>
              <span className="hero-frame__tag">
                playground · fixture proof
              </span>
            </div>
            <div className="hero-frame__stage hero-frame__stage--image">
              <img
                alt="Sketchi playground rendering a validated flowchart beside fixture IR"
                src="/media/sketchi-playground-preview.png"
              />
              <div className="hero-frame__proof" aria-label="Surface proof">
                <span>Direct Worker</span>
                <span>Fixture checks</span>
                <span>Excalidraw JSON</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
