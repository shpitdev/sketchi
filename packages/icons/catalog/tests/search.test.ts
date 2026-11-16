import { describe, expect, it } from "vitest";

import { getIconBySlug, iconManifest, nodeLogoIcons } from "../src/catalog";
import { FOLDED_INTO_SLUG } from "../src/folded-slugs";
import type { SketchiIcon } from "../src/manifest";
import { searchIcons } from "../src/search";

function icon(
	slug: string,
	name: string,
	collection: string,
	aliases: readonly string[] = [],
	keywords: readonly string[] = [],
): SketchiIcon {
	return {
		aliases,
		bytes: 100,
		collection,
		colorMode: "multicolor",
		keywords,
		name,
		slug,
		svgPath: `/icons/${slug}.svg`,
		viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
	};
}

const slugsOf = (icons: readonly SketchiIcon[], query: string, limit?: number) =>
	searchIcons(icons, { query, ...(limit === undefined ? {} : { limit }) }).map(
		({ icon: match }) => match.slug,
	);

/** Queries models and people send, and the mark the catalog must rank first. */
const FIRST: Readonly<Record<string, string>> = {
	"Cloudflare Workers": "cloudflareworkers",
	"cloudflare-workers": "cloudflareworkers",
	"Workers AI": "workersai",
	"Cloudflare R2": "cloudflare",
	"AWS Lambda": "aws-lambda",
	Lambda: "aws-lambda",
	"Lambda function": "aws-lambda-function",
	S3: "amazon-s3",
	"S3 bucket": "amazon-s3-bucket",
	"Amazon Simple Storage Service": "amazon-s3",
	"Amazon Aurora PostgreSQL": "amazon-aurora-postgresql-instance",
	"amazon web services": "amznwebserv",
	"Google Cloud Run": "cloud-run",
	"Google Cloud Platform": "googlecloud",
	"Google Kubernetes Engine": "gke",
	"Google Pub/Sub": "pubsub",
	"Google Gemini": "gemini",
	"Vercel Edge Functions": "vercel",
	"GitHub Actions": "githubactions",
	"Azure Blob Storage": "azure",
	"Microsoft Edge": "edge",
	"Supabase Edge Functions": "supabase",
	"Fly.io Machines": "flyio",
	"Next.js App Router": "nextjs",
	"OpenAI Assistants API": "openai",
	"tailwind css": "tailwindcss",
	k8s: "kubernetes",
	psql: "postgresql",
	gcp: "googlecloud",
	edge: "edge",
	ontology: "palantir-ontology",
	"workshop module": "palantir-workshop",
	Mindkit: "hivemind-app",
};

/** Generic words that name no product, even where a brand shares one of them. */
const NOTHING = [
	"edge functions",
	"serverless functions",
	"background workers",
	"actions runner",
	"stream processing",
	"linear regression",
	"storage bucket",
	"payment service",
	"user database",
];

describe("icon search ranking", () => {
	it("orders exact slug, name prefix, alias, substring, then collection, every word required", () => {
		const icons = [
			icon("cloud-item", "Storage", "target-collection"),
			icon("target-inside", "Middle", "misc"),
			icon("alias-item", "Other", "misc", ["target"]),
			icon("name-item", "Target Platform", "misc"),
			icon("target", "Different", "misc"),
		];
		expect(slugsOf(icons, "target")).toEqual([
			"target",
			"name-item",
			"alias-item",
			"target-inside",
			"cloud-item",
		]);
		const claude = [
			icon("claude-tool", "Claude", "ai-tools", [], ["code"]),
			icon("claude-only", "Claude", "ai-tools"),
			icon("unrelated-code", "Code", "ai-tools"),
		];
		expect(slugsOf(claude, "code claude")).toEqual(["claude-tool"]);
	});

	it("ranks the catalog's own mark first for product names, and nothing for generic words", () => {
		for (const [query, slug] of Object.entries(FIRST)) {
			expect(slugsOf(nodeLogoIcons, query)[0], query).toBe(slug);
		}
		for (const query of NOTHING) {
			expect(slugsOf(nodeLogoIcons, query), query).toEqual([]);
		}
		// Lambda's GPU cloud keeps its own slug behind AWS Lambda.
		expect(slugsOf(nodeLogoIcons, "lambda", 2)).toEqual(["aws-lambda", "lambda"]);
	});

	it("finds a folded slug's mark, and keeps vendor sets from taking generic words", () => {
		for (const [folded, kept] of Object.entries(FOLDED_INTO_SLUG)) {
			expect(getIconBySlug(folded)?.slug, folded).toBe(kept);
			expect(slugsOf(iconManifest.icons, folded)[0], folded).toBe(kept);
		}
		for (const query of ["calendar", "folder", "sunset"]) {
			expect(searchIcons(iconManifest.icons, { query })[0]?.icon.collection, query).not.toBe(
				"palantir",
			);
		}
	});
});
