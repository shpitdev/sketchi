import { describe, expect, it } from "vitest";

import type { SketchiIcon } from "./manifest";
import { iconSearchRank, PARTIAL_QUERY_RANK, searchIcons } from "./search";

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
		keywords,
		name,
		slug,
		svgPath: `/icons/${slug}.svg`,
		viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
	};
}

describe("ranked icon search", () => {
	it("orders exact slug, name prefix, alias, substring, then collection", () => {
		const icons = [
			icon("cloud-item", "Storage", "target-collection"),
			icon("target-inside", "Middle", "misc"),
			icon("alias-item", "Other", "misc", ["target"]),
			icon("name-item", "Target Platform", "misc"),
			icon("target", "Different", "misc"),
		];

		expect(searchIcons(icons, { query: "target" }).map(({ icon: match }) => match.slug)).toEqual([
			"target",
			"name-item",
			"alias-item",
			"target-inside",
			"cloud-item",
		]);
	});

	it("supports real-world aliases and collection filtering", () => {
		const icons = [
			icon("kubernetes", "Kubernetes", "devtools-ci", ["k8s", "kube"]),
			icon("googlecloud", "Google Cloud", "cloud-vendors", ["gcp"]),
			icon("postgresql", "PostgreSQL", "data-storage", ["postgres", "psql"]),
		];

		expect(searchIcons(icons, { query: "k8s" })[0]?.icon.slug).toBe("kubernetes");
		expect(searchIcons(icons, { query: "gcp" })[0]?.icon.slug).toBe("googlecloud");
		expect(searchIcons(icons, { query: "psql" })[0]?.icon.slug).toBe("postgresql");
		expect(
			searchIcons(icons, { collection: "data-storage" }).map(({ icon: match }) => match.slug),
		).toEqual(["postgresql"]);
	});

	it("requires every multi-word query token while preserving rank tiers", () => {
		const icons = [
			icon("collection-item", "Other", "amazon-web-services"),
			icon("semantic-item", "Amazon Console", "misc", [], ["web", "services"]),
			icon("alias-item", "Other", "misc", ["Amazon Web Services"]),
			icon("name-item", "Amazon Web Services Platform", "misc"),
			icon("amazon-only", "Amazon", "misc"),
		];

		expect(
			searchIcons(icons, { query: "amazon web services" }).map(({ icon: match, rank }) => [
				match.slug,
				rank,
			]),
		).toEqual([
			["name-item", 1],
			["alias-item", 2],
			["semantic-item", 3],
			["collection-item", 4],
		]);
		expect(
			searchIcons(icons, { query: "services amazon web" }).map(({ icon: match }) => match.slug),
		).toEqual(["alias-item", "semantic-item", "name-item", "collection-item"]);
	});

	it("supports reordered and cross-surface tokens without loose OR matches", () => {
		const icons = [
			icon("claude-tool", "Claude", "ai-tools", [], ["code"]),
			icon("claude-only", "Claude", "ai-tools"),
			icon("unrelated-code", "Code", "ai-tools"),
		];

		expect(
			searchIcons(icons, { query: "code claude" }).map(({ icon: match }) => match.slug),
		).toEqual(["claude-tool"]);
	});

	it("canonicalizes query case and whitespace before ranking", () => {
		const icons = [
			icon("ai-hub", "AI Hub", "misc"),
			icon("alias-item", "Aardvark", "misc", ["ai hub"]),
		];
		const rankedResults = (query: string) =>
			searchIcons(icons, { query }).map(({ icon: match, rank }) => [match.slug, rank]);

		const expected = [
			["ai-hub", 1],
			["alias-item", 2],
		];
		for (const query of ["ai hub", "AI HUB", "  ai hub  ", "ai   hub"]) {
			expect(rankedResults(query)).toEqual(expected);
		}
	});

	it("keeps empty and whitespace-only queries equivalent", () => {
		const icons = [icon("beta", "Beta", "misc"), icon("alpha", "Alpha", "misc")];
		const rankedResults = (query: string) =>
			searchIcons(icons, { query }).map(({ icon: match, rank }) => [match.slug, rank]);

		expect(rankedResults("   ")).toEqual(rankedResults(""));
		expect(rankedResults("   ")).toEqual([
			["alpha", 5],
			["beta", 5],
		]);
	});

	it("returns no match instead of treating unrelated terms as collection hits", () => {
		expect(iconSearchRank(icon("vercel", "Vercel", "hosting"), "missing")).toBeNull();
	});

	it("falls back to the icons a query's parts name, product mark before vendor", () => {
		const icons = [
			icon("cloudflare", "Cloudflare", "cloud-vendors"),
			icon("google", "Google", "cloud-vendors"),
			icon("gemini", "Gemini", "ai-model-families"),
			icon("workersai", "Workersai", "ai-infrastructure"),
			icon("flyio", "Flyio", "cloud-hosting-paas"),
		];
		const ranked = (query: string) =>
			searchIcons(icons, { query }).map(({ icon: match, rank }) => [match.slug, rank]);

		expect(ranked("Cloudflare Workers")).toEqual([["cloudflare", PARTIAL_QUERY_RANK]]);
		expect(ranked("cloudflare workers ai")).toEqual([
			["workersai", PARTIAL_QUERY_RANK],
			["cloudflare", PARTIAL_QUERY_RANK],
		]);
		// "google" is common English, but a vendor mark still stands for it.
		expect(ranked("Google Gemini")).toEqual([
			["gemini", PARTIAL_QUERY_RANK],
			["google", PARTIAL_QUERY_RANK],
		]);
		expect(ranked("Fly.io Machines")).toEqual([["flyio", PARTIAL_QUERY_RANK]]);
		expect(searchIcons(icons, { collection: "ai-model-families", query: "google gemini" })).toEqual(
			[{ icon: icons[2], rank: PARTIAL_QUERY_RANK }],
		);
	});

	it("never falls back on generic words that happen to name a brand", () => {
		const icons = [
			icon("edge", "Edge", "developer-clients"),
			icon("lambda", "Lambda", "ai-infrastructure"),
			icon("vercel", "Vercel", "cloud-hosting-paas"),
			icon("aws", "AWS", "cloud-vendors"),
		];
		const slugs = (query: string) =>
			searchIcons(icons, { query }).map(({ icon: match }) => match.slug);

		expect(slugs("Vercel Edge Functions")).toEqual(["vercel"]);
		expect(slugs("AWS Lambda")).toEqual(["aws"]);
		expect(slugs("edge functions")).toEqual([]);
		expect(slugs("lambda function")).toEqual([]);
		// Whole-query matches never reach the fallback.
		expect(slugs("edge")).toEqual(["edge"]);
		expect(slugs("lambda")).toEqual(["lambda"]);
	});
});
