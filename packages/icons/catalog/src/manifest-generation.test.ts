import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getIconBySlug, getIconSourceFile, iconManifest } from "./catalog";
import { decodeIconManifest } from "./manifest";
import { searchIcons } from "./search";
import { FOLDED_INTO_SLUG } from "./folded-slugs";
import { buildIconCatalog, COLLISION_CANONICAL_COLLECTIONS } from "./manifest-generation";

function sourceIcon(slug: string, collection: string) {
	return {
		bytes: 100,
		collection,
		color: { colorMode: "multicolor" as const },
		slug,
		urlPath: `/output/upload-ready/svg/${collection}/${slug}.svg`,
		viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
	};
}

interface ReviewGroup {
	readonly distinctBaseSlugs: readonly string[];
	readonly groupKey?: string;
	readonly key?: string;
	readonly rasterHash?: string;
	readonly visualHash?: string;
}

interface ReviewIcon {
	readonly baseSlug: string;
	readonly flags: readonly string[];
	readonly nearSimilarityGroupKey: string | null;
	readonly perceptualHash: string;
	readonly rasterHash: string;
	readonly similarityGroupKey: string | null;
	readonly slug: string;
	readonly visualHash: string;
}

interface ReviewData {
	readonly icons: readonly ReviewIcon[];
	readonly nearSimilarityGroups: readonly ReviewGroup[];
	readonly rasterDuplicateGroups: readonly ReviewGroup[];
	readonly summary: {
		readonly flagCounts: Readonly<Record<string, number>>;
		readonly nearSimilarityGroupsCount: number;
		readonly rasterDuplicateGroupsCount: number;
		readonly visualDuplicateGroupsCount: number;
	};
	readonly visualDuplicateGroups: readonly ReviewGroup[];
}

describe("public icon manifest generation", () => {
	it("keeps an explicit canonical collision slug and qualifies alternates", () => {
		const catalog = buildIconCatalog({
			icons: [sourceIcon("amp", "devtools-ci"), sourceIcon("amp", "ai-apps-agents")],
		});
		expect(catalog.manifest.icons.map((icon) => [icon.slug, icon.collection])).toEqual([
			["amp", "ai-apps-agents"],
			["amp-devtools-ci", "devtools-ci"],
		]);
		expect(catalog.manifest.icons[1]?.aliases).toContain("amp");
	});

	it("fails closed when a new collision has no product decision", () => {
		expect(() =>
			buildIconCatalog({
				icons: [sourceIcon("new-duplicate", "one"), sourceIcon("new-duplicate", "two")],
			}),
		).toThrow("Choose a canonical collection");
	});

	it("ships a Google Cloud product once, as its core-product icon", () => {
		const catalog = buildIconCatalog({
			icons: [
				sourceIcon("anthos", "gcp-legacy"),
				sourceIcon("anthos", "gcp"),
				sourceIcon("bigquery", "gcp-legacy"),
				sourceIcon("big-query", "gcp"),
				sourceIcon("pubsub", "gcp-legacy"),
				sourceIcon("speech-to-text", "gcp-legacy"),
			],
		});
		expect(
			catalog.manifest.icons.map(({ collection, name, slug, variant }) => [
				slug,
				name,
				collection,
				variant,
			]),
		).toEqual([
			["anthos", "Anthos", "gcp", undefined],
			["big-query", "BigQuery", "gcp", undefined],
			["pubsub", "Pub/Sub", "gcp-products", undefined],
			["speech-to-text", "Speech-to-Text", "gcp-products", undefined],
		]);
		// The folded console icon lends its names, never its collection-qualified slug.
		expect(catalog.manifest.icons[0]?.aliases).not.toContain("anthos-gcp-legacy");
		expect(catalog.manifest.icons[1]?.aliases).toContain("bigquery");
		expect(() => buildIconCatalog({ icons: [sourceIcon("anthos", "gcp-legacy")] })).toThrow(
			"anthos-gcp-legacy folds into anthos, which does not ship.",
		);
	});

	it("keeps collection-only tokens below semantic slug matches", () => {
		const catalog = buildIconCatalog({
			icons: [sourceIcon("postgresql", "data-storage"), sourceIcon("cloud-storage", "gcp")],
		});
		expect(
			searchIcons(catalog.manifest.icons, { query: "storage" }).map(({ icon, rank }) => [
				icon.slug,
				rank,
			]),
		).toEqual([
			["cloud-storage", 3],
			["postgresql", 4],
		]);
		expect(
			catalog.manifest.icons.find((icon) => icon.slug === "postgresql")?.keywords,
		).not.toContain("storage");
	});

	it("uses deliberate names and full-name aliases for curated product slugs", () => {
		const expectedNames = {
			adobefirefly: "Adobe Firefly",
			adobeillustrator: "Adobe Illustrator",
			affinitydesigner: "Affinity Designer",
			aihubmix: "AIHubMix",
			alibabacloud: "Alibaba Cloud",
			amznwebserv: "Amazon Web Services",
			aws: "AWS",
			baiducloud: "Baidu Cloud",
			cloudflare: "Cloudflare",
			claudecode: "Claude Code",
			codex: "Codex",
			digitalocean: "DigitalOcean",
			githubcopilot: "GitHub Copilot",
			googlecloud: "Google Cloud",
			kubernetes: "Kubernetes",
			lmstudio: "LM Studio",
			nextjs: "Next.js",
			nodejs: "Node.js",
			openai: "OpenAI",
			postgresql: "PostgreSQL",
			reactnative: "React Native",
			tailwindcss: "Tailwind CSS",
			vercel: "Vercel",
			vertexai: "Vertex AI",
			visualbasic: "Visual Basic",
			visualstudio: "Visual Studio",
			vscode: "Visual Studio Code",
		} as const;
		const catalog = buildIconCatalog({
			icons: Object.keys(expectedNames).map((slug) =>
				sourceIcon(slug, COLLISION_CANONICAL_COLLECTIONS[slug] ?? "products"),
			),
		});

		expect(
			Object.fromEntries(catalog.manifest.icons.map(({ name, slug }) => [slug, name])),
		).toEqual(expectedNames);

		for (const [slug, name] of Object.entries(expectedNames)) {
			expect(catalog.manifest.icons.find((icon) => icon.slug === slug)?.aliases).toContain(name);
		}
	});

	it("applies curated base names and aliases to wordmark variants", () => {
		const catalog = buildIconCatalog({
			icons: [
				{
					...sourceIcon("claudecode-text", "ai-model-providers"),
					baseSlug: "claudecode",
					variant: "text",
				},
			],
		});

		expect(catalog.manifest.icons[0]).toMatchObject({
			aliases: ["Claude Code"],
			name: "Claude Code Wordmark",
		});
	});

	it("uses product names and search aliases for Palantir icons", () => {
		const catalog = buildIconCatalog({
			icons: [
				sourceIcon("aip-autopilot-app", "palantir"),
				sourceIcon("ontology-objecttype-app", "palantir"),
				sourceIcon("palantir-ontology", "palantir"),
				sourceIcon("palantir-pipeline", "palantir"),
				sourceIcon("palantir-workshop", "palantir"),
				sourceIcon("pipeline-builder-graph-app", "palantir"),
				sourceIcon("sddi-app", "palantir"),
				sourceIcon("workshop-module-app", "palantir"),
			],
		});

		expect(
			Object.fromEntries(catalog.manifest.icons.map(({ name, slug }) => [slug, name])),
		).toMatchObject({
			"aip-autopilot-app": "Autopilot",
			"palantir-ontology": "Ontology",
			"palantir-pipeline": "Pipeline Builder",
			"palantir-workshop": "Workshop",
			"sddi-app": "HyperAuto (legacy)",
		});
		expect(searchIcons(catalog.manifest.icons, { query: "ontology" })[0]?.icon.slug).toBe(
			"palantir-ontology",
		);
		expect(searchIcons(catalog.manifest.icons, { query: "pipeline builder" })[0]?.icon.slug).toBe(
			"palantir-pipeline",
		);
		expect(searchIcons(catalog.manifest.icons, { query: "workshop" })[0]?.icon.slug).toBe(
			"palantir-workshop",
		);
	});

	it("ships a glyph several products share once, under every product's name", () => {
		const catalog = buildIconCatalog({
			icons: [
				sourceIcon("ontology-objecttype-app", "palantir"),
				sourceIcon("palantir-ontology", "palantir"),
			],
		});
		expect(catalog.manifest.icons.map(({ slug }) => slug)).toEqual(["palantir-ontology"]);
		expect(catalog.manifest.icons[0]?.aliases).toEqual(
			expect.arrayContaining(["Ontology Manager", "ontology-objecttype-app"]),
		);
		expect(() => buildIconCatalog({ icons: [sourceIcon("mindkit-app", "palantir")] })).toThrow(
			"mindkit-app folds into hivemind-app, which does not ship.",
		);

		// A folded slug still names its mark wherever a slug is looked up, and in search.
		const shipped = new Set(iconManifest.icons.map(({ slug }) => slug));
		for (const [folded, kept] of Object.entries(FOLDED_INTO_SLUG)) {
			expect(shipped.has(folded), folded).toBe(false);
			expect(getIconBySlug(folded)?.slug, folded).toBe(kept);
			expect(getIconSourceFile(folded), folded).toBe(getIconSourceFile(kept));
			expect(searchIcons(iconManifest.icons, { query: folded })[0]?.icon.slug, folded).toBe(kept);
		}
		for (const [query, slug] of [
			["Mindkit", "hivemind-app"],
			["Map Layer", "vortex-map-app"],
			["Walkthroughs", "training-app"],
			["workshop module", "palantir-workshop"],
		] as const) {
			expect(searchIcons(iconManifest.icons, { query })[0]?.icon.slug, query).toBe(slug);
		}
	});

	it("does not let Palantir aliases hijack generic icon searches", () => {
		for (const query of ["calendar", "folder", "sunset"]) {
			expect(searchIcons(iconManifest.icons, { query })[0]?.icon.collection, query).not.toBe(
				"palantir",
			);
		}
		expect(
			searchIcons(iconManifest.icons, { query: "application" }).map(({ rank }) => rank),
		).not.toContain(2);
	});

	it("keeps review aggregates in step with the icons", () => {
		const path = resolve(
			process.cwd(),
			"packages/icons/catalog/pipeline-output/review/review-data.json",
		);
		const review = JSON.parse(readFileSync(path, "utf8")) as ReviewData;
		const flagCounts = review.icons
			.flatMap(({ flags }) => flags)
			.reduce<Record<string, number>>((counts, flag) => {
				counts[flag] = (counts[flag] ?? 0) + 1;
				return counts;
			}, {});

		expect(review.summary.flagCounts).toEqual(flagCounts);
		expect(review.summary.visualDuplicateGroupsCount).toBe(review.visualDuplicateGroups.length);
		expect(review.summary.rasterDuplicateGroupsCount).toBe(review.rasterDuplicateGroups.length);
		expect(review.summary.nearSimilarityGroupsCount).toBe(review.nearSimilarityGroups.length);
	});

	it("ships a compact clean manifest with aliases and no review fields", () => {
		const source = JSON.stringify(iconManifest);
		const manifest = decodeIconManifest(JSON.parse(source));
		expect(manifest.summary.totalIcons).toBe(1528);
		expect(new Set(manifest.icons.map((icon) => icon.slug)).size).toBe(manifest.icons.length);
		expect(manifest.icons.find((icon) => icon.slug === "kubernetes")?.aliases).toContain("k8s");
		expect(manifest.icons.find((icon) => icon.slug === "adobefirefly-text")?.name).toBe(
			"Adobe Firefly Wordmark",
		);
		expect(manifest.icons.find((icon) => icon.slug === "adobeillustrator")?.name).toBe(
			"Adobe Illustrator",
		);
		expect(manifest.icons.find((icon) => icon.slug === "affinitydesigner")?.name).toBe(
			"Affinity Designer",
		);
		expect(manifest.icons.find((icon) => icon.slug === "tailwindcss")).toMatchObject({
			aliases: ["Tailwind CSS"],
			name: "Tailwind CSS",
		});
		expect(manifest.icons.find((icon) => icon.slug === "claudecode-text")).toMatchObject({
			aliases: ["Claude Code"],
			name: "Claude Code Wordmark",
		});
		expect(manifest.icons.find((icon) => icon.slug === "amznwebserv")).toMatchObject({
			aliases: ["Amazon Web Services"],
			name: "Amazon Web Services",
		});
		expect(
			searchIcons(manifest.icons, { query: "amazon web services" }).map(({ icon }) => icon.slug),
		).toEqual(["amznwebserv", "aws", "aws-text"]);
		const expectedFullNameMatches = {
			"adobe illustrator": ["adobeillustrator"],
			"affinity designer": ["affinitydesigner"],
			"amazon web services": ["amznwebserv", "aws", "aws-text"],
			"claude code": ["claudecode", "claudecode-text"],
			"tailwind css": ["tailwindcss"],
		} as const;
		for (const [fullName, expectedSlugs] of Object.entries(expectedFullNameMatches)) {
			expect(searchIcons(manifest.icons, { query: fullName }).map(({ icon }) => icon.slug)).toEqual(
				expectedSlugs,
			);
		}
		expect(source).not.toContain('"flags"');
		expect(source).not.toContain('"similarityGroupSize"');
		expect(Buffer.byteLength(source)).toBeLessThan(450_000);
	});
});
