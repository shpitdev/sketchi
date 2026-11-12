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
	/** Marks from other collections the pack also holds, such as the vendor's own logo. */
	readonly marks?: readonly string[];
	/** Marks its preview shows, in order; missing or undrawn ones are skipped. */
	readonly featured: readonly string[];
	/**
	 * What the pack is called in Excalidraw's library collection: a name and
	 * one plain English sentence. Only a pack with a listing can be published
	 * there.
	 */
	readonly excalidrawListing?: { readonly name: string; readonly description: string };
}

export const ALL_ICONS_PACK_ID = "all";

/**
 * Packs a wide shelf shows before "More packs": the whole catalog and the
 * vendor packs, two rows on a laptop so the icons stay on the first screen.
 */
export const SHELF_FIRST_PACK_IDS: ReadonlySet<string> = new Set([
	ALL_ICONS_PACK_ID,
	"palantir",
	"google-cloud",
	"aws",
	"aws-resources",
	"databricks",
	"snowflake",
]);

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
		excalidrawListing: {
			name: "Palantir Platform Icons",
			description:
				"Hand-drawn icons for Palantir's platforms and Foundry applications, such as Ontology, Workshop, Pipeline Builder, Quiver and AIP.",
		},
	},
	{
		id: "google-cloud",
		name: "Google Cloud",
		collections: ["gcp", "gcp-products"],
		featured: ["big-query", "cloud-run", "gke", "pubsub", "cloud-functions", "vertex-ai"],
		excalidrawListing: {
			name: "Google Cloud Icons",
			description:
				"Hand-drawn icons for Google Cloud products and categories in Google's colors, such as BigQuery, Cloud Run, GKE, Pub/Sub, Cloud Functions and Vertex AI.",
		},
	},
	{
		id: "aws",
		name: "AWS",
		collections: ["aws"],
		marks: ["aws"],
		featured: [
			"aws-lambda",
			"amazon-s3",
			"amazon-ec2",
			"amazon-dynamodb",
			"amazon-sqs",
			"amazon-cloudfront",
		],
		excalidrawListing: {
			name: "AWS Architecture Icons",
			description:
				"Hand-drawn AWS service icons for architecture diagrams, such as Lambda, S3, EC2, DynamoDB, SQS and CloudFront.",
		},
	},
	{
		id: "aws-resources",
		name: "AWS resources",
		collections: ["aws-resources"],
		featured: [
			"amazon-s3-bucket",
			"aws-lambda-function",
			"amazon-ec2-instance",
			"amazon-dynamodb-table",
			"amazon-sqs-queue",
			"amazon-sns-topic",
		],
		excalidrawListing: {
			name: "AWS Architecture Resource Icons",
			description:
				"Hand-drawn AWS resource icons for architecture diagrams, such as S3 buckets, Lambda functions, EC2 instances, DynamoDB tables and SQS queues.",
		},
	},
	{
		id: "databricks",
		name: "Databricks",
		collections: ["databricks"],
		featured: [
			"databricks",
			"unity-catalog",
			"delta-lake",
			"databricks-sql",
			"lakeflow",
			"managed-mlflow",
		],
		excalidrawListing: {
			name: "Databricks Icons",
			description:
				"Hand-drawn Databricks product icons for data platform diagrams, such as Unity Catalog, Delta Lake, Databricks SQL, Lakeflow and MLflow.",
		},
	},
	{
		id: "snowflake",
		name: "Snowflake",
		collections: ["snowflake"],
		marks: ["snowflake"],
		featured: [
			"snowflake",
			"snowflake-virtual-warehouse",
			"snowflake-dynamic-table",
			"snowpark",
			"snowflake-cortex",
			"streamlit-in-snowflake",
		],
		excalidrawListing: {
			name: "Snowflake Icons",
			description:
				"Hand-drawn Snowflake icons in Snowflake's colors, such as warehouses, dynamic tables, Snowpark, Cortex and Streamlit in Snowflake.",
		},
	},
	{
		id: "ai-models",
		name: "AI labs & models",
		collections: ["ai-model-labs", "ai-model-families", "ai-model-providers"],
		featured: ["anthropic", "claude", "gemini", "mistral", "deepseek", "qwen"],
		excalidrawListing: {
			name: "AI Labs and Models Logos",
			description:
				"Hand-drawn logos of AI labs and model families, such as Anthropic, Claude, Gemini, Mistral, DeepSeek and Qwen.",
		},
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
		excalidrawListing: {
			name: "AI Tools and Agents Logos",
			description:
				"Hand-drawn logos of AI apps, coding agents, inference providers and frameworks, such as Cursor, Hugging Face, LangChain, Ollama and n8n.",
		},
	},
	{
		id: "cloud",
		name: "Cloud",
		collections: ["cloud-vendors", "cloud-hosting-paas", "cloud-platforms"],
		featured: ["aws", "azure", "googlecloud", "cloudflare", "vercel", "digitalocean"],
		excalidrawListing: {
			name: "Cloud Platform Logos",
			description:
				"Hand-drawn logos of cloud vendors and hosting platforms, such as AWS, Azure, Google Cloud, Cloudflare, Vercel and DigitalOcean.",
		},
	},
	{
		id: "data",
		name: "Data & backend",
		collections: ["data-storage", "auth-identity", "observability-security"],
		featured: ["postgresql", "redis", "mongodb", "snowflake", "datadog", "auth0"],
		excalidrawListing: {
			name: "Data and Backend Logos",
			description:
				"Hand-drawn logos of databases, auth providers and observability tools, such as PostgreSQL, Redis, MongoDB, Snowflake, Datadog and Auth0.",
		},
	},
	{
		id: "devtools",
		name: "Developer tools",
		collections: ["devtools-ci", "developer-clients", "operating-systems"],
		featured: ["github", "docker", "kubernetes", "terraform", "vscode", "linux"],
		excalidrawListing: {
			name: "Developer Tools Logos",
			description:
				"Hand-drawn logos of developer tools, CI services, editors, browsers and operating systems, such as GitHub, Docker, Kubernetes, Terraform and VS Code.",
		},
	},
	{
		id: "saas-payments",
		name: "SaaS & payments",
		collections: [
			"payments-fintech",
			"social-communication",
			"design-productivity",
			"ecommerce-retail",
		],
		featured: ["stripe", "slack", "shopify", "paypal", "notion", "figma"],
		excalidrawListing: {
			name: "SaaS and Payments Logos",
			description:
				"Hand-drawn logos of payment providers, messaging apps and business software, such as Stripe, Slack, Shopify, PayPal, Notion and Figma.",
		},
	},
	{
		id: "languages",
		name: "Languages & frameworks",
		collections: ["programming-languages", "frontend-frameworks", "frameworks-runtimes"],
		featured: ["typescript", "python", "react", "rust", "go", "nextjs"],
		excalidrawListing: {
			name: "Languages and Frameworks Logos",
			description:
				"Hand-drawn logos of programming languages, frameworks and runtimes, such as TypeScript, Python, React, Rust, Go and Next.js.",
		},
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
	/** A hash of the built library: what a submission to Excalidraw is recorded against. */
	readonly version: string;
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
	const marks = new Set(pack.marks);
	return icons.flatMap((icon) => {
		const recipe = drawings[icon.slug];
		const member = !collections || collections.has(icon.collection) || marks.has(icon.slug);
		if (!recipe || !member) return [];
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

export function packSummary(
	pack: IconPackDefinition,
	members: readonly PackIcon[],
	version: string,
): PackSummary {
	return {
		id: pack.id,
		name: pack.name,
		version,
		count: members.length,
		preview: packPreview(pack, members),
	};
}

export function packPagePath(id: string): string {
	return `/packs/${id}`;
}

/** The pack's drawn marks, which its page loads instead of the whole catalog. */
export function packIconsPath(id: string): string {
	return `/packs/${id}.icons.json`;
}

/** A pack's published marks; entries that are not drawn marks are dropped. */
export function decodePackIcons(payload: unknown): PackIcon[] {
	if (!Array.isArray(payload)) throw new Error("Pack icons are not a list.");
	return payload.filter(isPackIcon);
}

/** The site's link-preview card. */
export const SITE_CARD_PATH = "/card.png";

/** The pack's link-preview card: its name, its count and a strip of its marks. */
export function packCardPath(id: string): string {
	return `/packs/${id}.card.png`;
}

/** The pack as an Excalidraw library; the whole catalog keeps its original URL. */
export function packLibraryPath(id: string): string {
	return id === ALL_ICONS_PACK_ID ? DRAWINGS_LIBRARY_PATH : `/packs/${id}.excalidrawlib`;
}

/** The name a downloaded library is saved under. */
export function packLibraryFileName(id: string): string {
	return id === ALL_ICONS_PACK_ID ? "sketchi-icons.excalidrawlib" : `sketchi-${id}.excalidrawlib`;
}

const EXCALIDRAW_LIBRARIES_RAW =
	"https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/";

/**
 * Whether a link adds a library on excalidraw.com: `?addLibrary=` with a
 * library file from Excalidraw's collection, the only host it imports from.
 */
export function isExcalidrawInstallUrl(href: string): boolean {
	const url = URL.parse(href);
	if (url?.origin !== "https://excalidraw.com" || url.pathname !== "/" || url.hash) return false;
	const library = url.searchParams.get("addLibrary");
	return (
		library !== null &&
		library.startsWith(EXCALIDRAW_LIBRARIES_RAW) &&
		URL.parse(library)?.pathname.endsWith(".excalidrawlib") === true
	);
}

/** A pack version: the first 16 hex digits of the SHA-256 of its library file. */
export async function packVersion(library: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(library));
	return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** The preview Excalidraw's collection shows for the pack, built with its library. */
export function packPreviewImagePath(id: string): string {
	return `/packs/${id}.preview.jpg`;
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
		const { count, id, name, preview, version } = entry as Record<string, unknown>;
		if (typeof id !== "string" || !findPack(id)) return [];
		if (
			typeof name !== "string" ||
			typeof version !== "string" ||
			typeof count !== "number" ||
			!Array.isArray(preview)
		) {
			return [];
		}
		return [{ id, name, version, count, preview: preview.filter(isPackIcon) }];
	});
}
