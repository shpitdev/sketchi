import { BenefitStrip } from "../benefit-strip/index.js";
import { CliBand } from "../cli-band/index.js";
import { HomeHero } from "../home-hero/index.js";
import { IconWall } from "../icon-wall/index.js";
import { SiteShell } from "../site-shell/site-shell.js";
import { DEFAULT_WEB_SURFACE_URLS, type WebSurfaceUrls } from "../../lib/surface-urls";

export interface MarketingHomeProps {
	surfaceUrls?: WebSurfaceUrls;
}

export function MarketingHome({ surfaceUrls = DEFAULT_WEB_SURFACE_URLS }: MarketingHomeProps) {
	return (
		<SiteShell activePath="/" surfaceUrls={surfaceUrls}>
			<HomeHero primaryHref={surfaceUrls.playground} />
			<BenefitStrip />
			<CliBand />
			<IconWall iconsHref={surfaceUrls.icons} />
		</SiteShell>
	);
}
