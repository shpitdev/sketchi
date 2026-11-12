import { Button } from "@sketchi/ui/components/button";

import { BrandIcon } from "../brand-icon/index.js";
import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface IconWallProps {
	/** Link to the full icon library surface. */
	iconsHref?: string;
}

const rowOne = [
	"react",
	"typescript",
	"nextjs",
	"tailwindcss",
	"nodejs",
	"python",
	"go",
	"rust",
	"graphql",
	"prisma",
	"figma",
	"linear",
	"notion",
	"slack",
];

const rowTwo = [
	"cloudflare",
	"aws",
	"googlecloud",
	"vercel",
	"docker",
	"kubernetes",
	"postgresql",
	"redis",
	"mongodb",
	"supabase",
	"github",
	"openai",
	"anthropic",
];

/** The vendor packs on Sketchi Icons, by their page ids there. */
export const ICON_PACK_LINKS = [
	{ id: "palantir", name: "Palantir" },
	{ id: "aws", name: "AWS" },
	{ id: "google-cloud", name: "Google Cloud" },
	{ id: "databricks", name: "Databricks" },
	{ id: "snowflake", name: "Snowflake" },
	{ id: "saas-payments", name: "SaaS & payments" },
] as const;

function label(slug: string): string {
	return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function Rail({ slugs, reverse }: { slugs: readonly string[]; reverse?: boolean }) {
	return (
		<div className="icon-rail">
			<div className={`icon-rail__track${reverse ? " icon-rail__track--reverse" : ""}`}>
				{[0, 1].map((cycle) => (
					<div className="icon-rail__cycle" data-icon-cycle key={cycle}>
						{slugs.map((slug) => (
							<BrandIcon
								key={slug}
								label={label(slug)}
								loading="eager"
								size={30}
								src={`/brand/${slug}.svg`}
								tile
							/>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * The logos diagrams draw, as two moving rows, and the hand-drawn packs on
 * Sketchi Icons that work in any Excalidraw drawing.
 */
export function IconWall({ iconsHref = DEFAULT_WEB_SURFACE_URLS.icons }: IconWallProps) {
	const iconsBase = iconsHref.replace(/\/+$/u, "");

	return (
		<section className="sk-section icon-wall" id="icons">
			<div className="sk-shell">
				<div className="icon-wall__head">
					<div className="icon-wall__copy">
						<h2 className="sk-section__title icon-wall__title">Product logos and icon packs</h2>
						<p className="icon-wall__lead">
							Diagrams take their logos from Sketchi Icons, where you can also add hand-drawn packs
							to your own Excalidraw library.
						</p>
						<ul aria-label="Icon packs" className="icon-wall__packs">
							{ICON_PACK_LINKS.map((pack) => (
								<li key={pack.id}>
									<a className="icon-wall__pack" href={`${iconsBase}/packs/${pack.id}`}>
										{pack.name}
									</a>
								</li>
							))}
						</ul>
					</div>
					<Button asChild size="xl" variant="outline">
						<a href={iconsHref}>Browse icons</a>
					</Button>
				</div>

				<div className="icon-wall__rails" aria-hidden="true">
					<Rail slugs={rowOne} />
					<Rail reverse slugs={rowTwo} />
				</div>
			</div>
		</section>
	);
}
