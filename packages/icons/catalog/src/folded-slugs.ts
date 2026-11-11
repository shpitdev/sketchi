/**
 * Catalog marks that drew the same glyph as another product's mark. Each now
 * ships once, under the slug it maps to. The folded slug keeps resolving there
 * wherever a slug is looked up (saved diagrams, API and page URLs, recipes),
 * its names become that mark's aliases, and its published SVG stays in place.
 */
export const FOLDED_INTO_SLUG: Readonly<Record<string, string>> = {
	"aip-assist-tutorials-app": "training-app",
	copilotgithub: "githubcopilot",
	"default-app": "foundry-applications-portal",
	"mindkit-app": "hivemind-app",
	"ontology-objecttype-app": "palantir-ontology",
	"pipeline-builder-graph-app": "palantir-pipeline",
	"vortex-map-layer-app": "vortex-map-app",
	"workshop-module-app": "palantir-workshop",
};

/** The slug a catalog mark ships under: its own, or the mark it was folded into. */
export function canonicalIconSlug(slug: string): string {
	return Object.hasOwn(FOLDED_INTO_SLUG, slug) ? FOLDED_INTO_SLUG[slug]! : slug;
}
