/**
 * Catalog marks that name the same product as another mark, keyed by public
 * slug. Each product ships once, under the slug it maps to. The folded slug
 * keeps resolving there wherever a slug is looked up (saved diagrams, API and
 * page URLs, recipes), its names become that mark's aliases, and its published
 * SVG stays in place.
 *
 * Two kinds fold: marks that drew the same glyph as another product's, and
 * Google Cloud products in both of Google's sets. Such a product ships Google's
 * current core-product icon (`gcp`); its icon from the per-product console set
 * (`gcp-products`) folds into it. Category icons do not fold: they name an area
 * ("Storage", "Marketplace"), not a product.
 */
export const FOLDED_INTO_SLUG: Readonly<Record<string, string>> = {
	"aip-assist-tutorials-app": "training-app",
	"anthos-gcp-legacy": "anthos",
	"apigee-api-platform": "apigee",
	bigquery: "big-query",
	"cloud-run-gcp-legacy": "cloud-run",
	"cloud-spanner-gcp-legacy": "cloud-spanner",
	"cloud-sql-gcp-legacy": "cloud-sql",
	"cloud-storage-gcp-legacy": "cloud-storage",
	"compute-engine-gcp-legacy": "compute-engine",
	copilotgithub: "githubcopilot",
	"default-app": "foundry-applications-portal",
	"google-kubernetes-engine": "gke",
	"looker-gcp-legacy": "looker",
	"mindkit-app": "hivemind-app",
	"ontology-objecttype-app": "palantir-ontology",
	"pipeline-builder-graph-app": "palantir-pipeline",
	"security-command-center-gcp-legacy": "security-command-center",
	"vertexai-gcp-legacy": "vertex-ai",
	"vortex-map-layer-app": "vortex-map-app",
	"workshop-module-app": "palantir-workshop",
};

/** The slug a catalog mark ships under: its own, or the mark it was folded into. */
export function canonicalIconSlug(slug: string): string {
	return Object.hasOwn(FOLDED_INTO_SLUG, slug) ? FOLDED_INTO_SLUG[slug]! : slug;
}
