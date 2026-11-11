import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import type { SketchiIcon } from "@sketchi/icon-catalog";

import { DRAWINGS_LIBRARY_PATH, type IconDrawings } from "./drawings.js";

/**
 * A pack is a ready-made Excalidraw library: the drawn marks of some catalog
 * collections, or of the whole catalog. Membership is by collection, so a
 * mark drawn or added to one of them joins the pack on the next build.
 */
export interface IconPackDefinition {
	readonly id: string;
	readonly name: string;
	/** Collections the pack draws from; omitted, it holds every drawn mark. */
	readonly collections?: readonly string[];
	/** Marks its preview shows, in order; missing or undrawn ones are skipped. */
	readonly featured: readonly string[];
}

export const ALL_ICONS_PACK_ID = "all";

export const ICON_PACKS: readonly IconPackDefinition[] = [
	{
		id: ALL_ICONS_PACK_ID,
		name: "All icons",
		featured: ["anthropic", "palantir", "aws", "postgresql", "react", "kubernetes"],
	},
	{
		id: "palantir",
		name: "Palantir",
		collections: ["palantir"],
		featured: [
			"palantir",
			"foundry-platform",
			"palantir-ontology",
			"palantir-workshop",
			"palantir-pipeline",
			"quiver-app",
		],
	},
	{
		id: "ai-models",
		name: "AI labs & models",
		collections: ["ai-model-labs", "ai-model-families", "ai-model-providers"],
		featured: ["anthropic", "claude", "gemini", "mistral", "deepseek", "qwen"],
	},
	{
		id: "ai-tools",
		name: "AI tools & agents",
		collections: [
			"ai-apps-agents",
			"ai-devtools",
			"ai-harness-wrappers",
			"ai-ecosystem",
			"ai-infrastructure",
		],
		featured: ["cursor", "huggingface", "langchain", "ollama", "n8n", "mcp"],
	},
	{
		id: "cloud",
		name: "Cloud",
		collections: ["cloud-vendors", "cloud-hosting-paas", "cloud-platforms", "gcp"],
		featured: ["aws", "azure", "googlecloud", "cloudflare", "vercel", "big-query"],
	},
	{
		id: "data",
		name: "Data & backend",
		collections: ["data-storage", "auth-identity", "observability-security"],
		featured: ["postgresql", "redis", "mongodb", "snowflake", "datadog", "auth0"],
	},
	{
		id: "devtools",
		name: "Developer tools",
		collections: ["devtools-ci", "developer-clients", "operating-systems"],
		featured: ["github", "docker", "kubernetes", "terraform", "vscode", "linux"],
	},
	{
		id: "languages",
		name: "Languages & frameworks",
		collections: ["programming-languages", "frontend-frameworks", "frameworks-runtimes"],
		featured: ["typescript", "python", "react", "rust", "go", "nextjs"],
	},
];

/** One drawn mark in a pack: its library item is named after the product. */
export interface PackIcon {
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
}

/** What the home page and a pack's page show before its icons load. */
export interface PackSummary {
	readonly id: string;
	readonly name: string;
	readonly count: number;
	readonly preview: readonly PackIcon[];
}

export const PACK_PREVIEW_SIZE = 6;
/** Every pack's summary, built with the pack files. */
export const PACK_INDEX_PATH = "/packs/index.json";

export function findPack(id: string): IconPackDefinition | undefined {
	return ICON_PACKS.find((pack) => pack.id === id);
}

/** The pack's drawn marks, in catalog order. */
export function packIcons(
	pack: IconPackDefinition,
	icons: readonly Pick<SketchiIcon, "collection" | "name" | "slug">[],
	drawings: IconDrawings,
): PackIcon[] {
	const collections = pack.collections ? new Set(pack.collections) : undefined;
	return icons.flatMap((icon) => {
		const recipe = drawings[icon.slug];
		if (!recipe || (collections && !collections.has(icon.collection))) return [];
		return [{ slug: icon.slug, name: icon.name, recipe }];
	});
}

/** The featured marks the pack holds, topped up from the rest of it. */
export function packPreview(
	pack: IconPackDefinition,
	members: readonly PackIcon[],
	size = PACK_PREVIEW_SIZE,
): PackIcon[] {
	const bySlug = new Map(members.map((icon) => [icon.slug, icon]));
	const featured = pack.featured.flatMap((slug) => bySlug.get(slug) ?? []);
	const shown = new Set(featured.map((icon) => icon.slug));
	return [...featured, ...members.filter((icon) => !shown.has(icon.slug))].slice(0, size);
}

export function packSummary(pack: IconPackDefinition, members: readonly PackIcon[]): PackSummary {
	return {
		id: pack.id,
		name: pack.name,
		count: members.length,
		preview: packPreview(pack, members),
	};
}

export function packPagePath(id: string): string {
	return `/packs/${id}`;
}

/** The pack as an Excalidraw library; the whole catalog keeps its original URL. */
export function packLibraryPath(id: string): string {
	return id === ALL_ICONS_PACK_ID ? DRAWINGS_LIBRARY_PATH : `/packs/${id}.excalidrawlib`;
}

/** The name a downloaded library is saved under. */
export function packLibraryFileName(id: string): string {
	return id === ALL_ICONS_PACK_ID ? "sketchi-icons.excalidrawlib" : `sketchi-${id}.excalidrawlib`;
}

/** The pack laid out as an Excalidraw scene, one labeled drawing per mark. */
export function packScenePath(id: string): string {
	return `/packs/${id}.excalidraw`;
}

/**
 * excalidraw.com opens a scene from any URL that serves it with CORS
 * (`#url=`). It only imports libraries from its own hosts, so a pack opens as
 * a scene there and downloads as a library.
 */
export function openInExcalidrawUrl(id: string, origin: string): string {
	return `https://excalidraw.com/#url=${encodeURIComponent(new URL(packScenePath(id), origin).href)}`;
}

function isPackIcon(value: unknown): value is PackIcon {
	if (typeof value !== "object" || value === null) return false;
	const { name, recipe, slug } = value as Record<string, unknown>;
	return (
		typeof slug === "string" &&
		typeof name === "string" &&
		typeof recipe === "object" &&
		recipe !== null &&
		Array.isArray((recipe as { parts?: unknown }).parts)
	);
}

/** The published index, keeping only packs this build defines. */
export function decodePackIndex(payload: unknown): PackSummary[] {
	if (!Array.isArray(payload)) throw new Error("Pack index is not a list.");
	return payload.flatMap((entry: unknown) => {
		if (typeof entry !== "object" || entry === null) return [];
		const { count, id, name, preview } = entry as Record<string, unknown>;
		if (typeof id !== "string" || !findPack(id)) return [];
		if (typeof name !== "string" || typeof count !== "number" || !Array.isArray(preview)) {
			return [];
		}
		return [{ id, name, count, preview: preview.filter(isPackIcon) }];
	});
}
