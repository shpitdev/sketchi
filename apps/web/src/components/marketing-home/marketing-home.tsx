import { CliBand } from "../cli-band/index.js";
import { CtaBand } from "../cta-band/index.js";
import { FeatureGrid } from "../feature-grid/index.js";
import { HomeHero } from "../home-hero/index.js";
import { IconWall } from "../icon-wall/index.js";
import { SiteFooter } from "../site-footer/index.js";
import { SiteHeader } from "../site-header/index.js";
import {
  DEFAULT_WEB_SURFACE_URLS,
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
        <HomeHero primaryHref={surfaceUrls.playground} />
        <FeatureGrid />
        <CliBand />
        <IconWall iconsHref={surfaceUrls.icons} />
        <CtaBand playgroundHref={surfaceUrls.playground} />
      </main>

      <SiteFooter surfaceUrls={surfaceUrls} />
    </div>
  );
}
