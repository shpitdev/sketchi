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

        <section className="sk-section" id="pipeline">
          <div className="sk-shell">
            <div className="sk-section__head">
              <p className="sk-eyebrow">Pipeline</p>
              <h2 className="sk-section__title">Generation stays inspectable.</h2>
              <p className="sk-section__lead">
                Each stage is its own package, so failures stay local and
                testable.
              </p>
            </div>
            <PipelineFlow />
          </div>
        </section>

        <section className="sk-section" id="surfaces">
          <div className="sk-shell">
            <div className="sk-section__head">
              <p className="sk-eyebrow">Surfaces</p>
              <h2 className="sk-section__title">Four surfaces, one pipeline.</h2>
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
                domain={surfaceLinkLabel(surfaceUrls.icons, "icons.sketchi.app")}
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
