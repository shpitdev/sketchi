import { describe, expect, it } from "vitest";

import { placeNodeLogos } from "./logo-placement";

const logos = [
	{ slug: "github", name: "Github" },
	{ slug: "docker", name: "Docker" },
	{ slug: "cloudflare", name: "Cloudflare" },
	{ slug: "postgresql", name: "PostgreSQL", aliases: ["postgres", "psql"] },
	{ slug: "redis", name: "Redis" },
];

function icons(nodes: ReturnType<typeof placeNodeLogos>["nodes"]) {
	return nodes.map((node) => node.icon?.slug);
}

describe("placeNodeLogos", () => {
	it("moves shifted logos onto the nodes whose labels name them", () => {
		// The live failure: each logo landed one node late.
		const result = placeNodeLogos(
			[
				{ id: "push", label: "Push to GitHub" },
				{ id: "build", label: "Build Docker image", icon: { slug: "github" } },
				{ id: "test", label: "Run test suite", icon: { slug: "docker" } },
				{
					id: "deploy",
					label: "Deploy to Cloudflare Workers",
					icon: { slug: "cloudflare" },
				},
			],
			logos,
		);

		expect(icons(result.nodes)).toEqual(["github", "docker", undefined, "cloudflare"]);
		expect(result.diagnostics).toEqual([
			expect.stringContaining('icon_placed: node "push" names github'),
			expect.stringContaining('icon_placed: node "build" names docker'),
			expect.stringContaining('icon_dropped: node "test" logo "docker"'),
		]);
	});

	it("matches aliases and keeps model choices on nodes no label claims", () => {
		const result = placeNodeLogos(
			[
				{ id: "store", label: "Store rows in Postgres" },
				{ id: "cache", label: "Cache lookup", icon: { slug: "redis" } },
				{ id: "made-up", label: "Queue work", icon: { slug: "kafka" } },
			],
			logos,
		);

		expect(icons(result.nodes)).toEqual(["postgresql", "redis", undefined]);
		expect(result.diagnostics).toEqual([
			expect.stringContaining('icon_placed: node "store" names postgresql'),
			expect.stringContaining('icon_not_in_prompt: node "made-up" icon "kafka"'),
		]);
	});

	it("never places everyday-word logos from a label, only the model's choice", () => {
		const result = placeNodeLogos(
			[
				{ id: "build", label: "Build the API service", icon: { slug: "go" } },
				{ id: "live", label: "Go Live" },
				{ id: "ship", label: "Deploy With Go" },
				{ id: "file", label: "File Ticket In Linear" },
				{ id: "track", label: "Track work", icon: { slug: "linear" } },
				{ id: "page", label: "Render Page" },
			],
			[
				{ slug: "go", name: "Go" },
				{ slug: "linear", name: "Linear" },
				{ slug: "render", name: "Render" },
			],
		);

		expect(icons(result.nodes)).toEqual([
			"go",
			undefined,
			undefined,
			undefined,
			"linear",
			undefined,
		]);
		expect(result.diagnostics).toEqual([]);
	});

	it("leaves nodes unchanged when nothing needs placing", () => {
		const nodes = [
			{ id: "push", label: "Push to GitHub", icon: { slug: "github" } },
			{ id: "plain", label: "Review the change" },
		];
		expect(placeNodeLogos(nodes, logos)).toEqual({ diagnostics: [], nodes });
		expect(placeNodeLogos(nodes, []).nodes.map((node) => node.icon)).toEqual([
			undefined,
			undefined,
		]);
	});
});
