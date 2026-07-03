import { HomeHero } from "../home-hero/index.js";
import { PipelineFlow } from "../pipeline-flow/index.js";
import { SiteFooter } from "../site-footer/index.js";
import { SiteHeader } from "../site-header/index.js";
import { SurfaceCard } from "../surface-card/index.js";
import {
  DEFAULT_WEB_SURFACE_URLS,
  surfaceLinkLabel,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface MarketingHomeProps {
  surfaceUrls?: WebSurfaceUrls;
}

export function MarketingHome({
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: MarketingHomeProps) {
  return (
    <div className="sketchi-web">
      <SiteHeader activePath="/" surfaceUrls={surfaceUrls} />

      <main id="top">
        <HomeHero primaryHref={surfaceUrls.excalidraw} />

        <section className="sk-section sk-section--readiness" id="readiness">
          <div className="sk-shell">
            <div className="readiness-grid" aria-label="Sketchi readiness">
              <article className="readiness-card readiness-card--live">
                <p className="sk-eyebrow">Live now</p>
                <h2>Direct Workers are the review surface.</h2>
                <p>
                  The v2 apps deploy independently and stay reachable before any
                  custom-domain cutover.
                </p>
              </article>
              <article className="readiness-card">
                <span className="readiness-card__k">01</span>
                <h3>No-auth app shells</h3>
                <p>Open the workspace, icon library, and playground today.</p>
              </article>
              <article className="readiness-card">
                <span className="readiness-card__k">02</span>
                <h3>Deterministic diagram core</h3>
                <p>
                  Models produce typed intent; Sketchi owns layout and export.
                </p>
              </article>
              <article className="readiness-card">
                <span className="readiness-card__k">03</span>
                <h3>Manual DNS later</h3>
                <p>
                  Custom domains stay detached until these surfaces beat v1.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="sk-section" id="pipeline">
          <div className="sk-shell">
            <div className="sk-section__head">
              <p className="sk-eyebrow">Pipeline</p>
              <h2 className="sk-section__title">
                Generation stays inspectable.
              </h2>
              <p className="sk-section__lead">
                Each stage is its own package, so failures stay local and
                testable.
              </p>
            </div>
            <PipelineFlow />
            <div className="playground-preview">
              <a
                className="playground-preview__shot"
                href={surfaceUrls.playground}
              >
                <img
                  alt="Sketchi playground with a rendered flowchart, fixture checks, and IR"
                  src="/media/sketchi-playground-preview.png"
                />
              </a>
              <div>
                <p className="sk-eyebrow">Proof surface</p>
                <h3 className="playground-preview__title">
                  The playground keeps generation inspectable.
                </h3>
                <ul className="playground-preview__list">
                  <li>
                    <b>Fixture checks</b>
                    Flowchart requirements are visible next to the canvas.
                  </li>
                  <li>
                    <b>Real Excalidraw output</b>
                    Scene conversion is rendered in the same browser surface.
                  </li>
                  <li>
                    <b>Raw IR beside the diagram</b>
                    Reviewers can inspect the accepted structure directly.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="sk-section" id="surfaces">
          <div className="sk-shell">
            <div className="sk-section__head">
              <p className="sk-eyebrow">Surfaces</p>
              <h2 className="sk-section__title">
                Four surfaces, one pipeline.
              </h2>
              <p className="sk-section__lead">
                Each ships on its own. None need a sign-in.
              </p>
            </div>
            <div className="surface-grid">
              <SurfaceCard
                cta="Open workspace"
                desc="Inspect the IR, scene, and a live Excalidraw canvas."
                domain={surfaceLinkLabel(
                  surfaceUrls.excalidraw,
                  "excalidraw.sketchi.app",
                )}
                href={surfaceUrls.excalidraw}
                name="Excalidraw workspace"
              />
              <SurfaceCard
                cta="Browse icons"
                desc="Search and copy 1,400+ curated icons."
                domain={surfaceLinkLabel(
                  surfaceUrls.icons,
                  "icons.sketchi.app",
                )}
                href={surfaceUrls.icons}
                name="Icon library"
              />
              <SurfaceCard
                cta="Open playground"
                desc="Evaluate prompts against the deterministic pipeline."
                domain={surfaceLinkLabel(
                  surfaceUrls.playground,
                  "playground.sketchi.app",
                )}
                href={surfaceUrls.playground}
                name="Scenario playground"
              />
              <SurfaceCard
                cta="Open docs"
                desc="Pipeline, diagram types, and deploys."
                domain="sketchi.app/docs"
                href="/docs"
                name="Documentation"
                status="live"
              />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter surfaceUrls={surfaceUrls} />
    </div>
  );
}
