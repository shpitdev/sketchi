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

	describe("vendor logos", () => {
		const vendors = [
			{
				slug: "kubernetes",
				name: "Kubernetes",
				aliases: ["k8s", "kube"],
				collection: "devtools-ci",
			},
			{ slug: "aws", name: "AWS", aliases: ["amazon"], collection: "cloud-vendors" },
			{ slug: "cloudflare", name: "Cloudflare", collection: "cloud-vendors" },
			{ slug: "docker", name: "Docker", collection: "devtools-ci" },
		];

		it("drops a vendor logo from a node whose label does not name the vendor", () => {
			const result = placeNodeLogos(
				[
					{ id: "ingress", label: "Ingress controller", icon: { slug: "kubernetes" } },
					{ id: "build", label: "Build the image", icon: { slug: "docker" } },
					{ id: "s3", label: "S3 bucket", icon: { slug: "aws" } },
					{ id: "edge", label: "Edge worker", icon: { slug: "cloudflare" } },
				],
				vendors,
			);

			expect(icons(result.nodes)).toEqual([undefined, "docker", undefined, undefined]);
			expect(result.diagnostics).toEqual([
				'icon_dropped: node "ingress" logo "kubernetes" is a vendor logo, but its label "Ingress controller" does not name Kubernetes.',
				'icon_dropped: node "s3" logo "aws" is a vendor logo, but its label "S3 bucket" does not name AWS.',
				'icon_dropped: node "edge" logo "cloudflare" is a vendor logo, but its label "Edge worker" does not name Cloudflare.',
			]);
		});

		it("keeps a vendor logo on a node whose label names the vendor", () => {
			const result = placeNodeLogos(
				[
					{ id: "ship", label: "Ship to Cloudflare Workers", icon: { slug: "cloudflare" } },
					{ id: "fn", label: "Amazon Lambda", icon: { slug: "aws" } },
					{ id: "gke", label: "GKE cluster", icon: { slug: "kubernetes" } },
				],
				vendors,
			);

			expect(icons(result.nodes)).toEqual(["cloudflare", "aws", "kubernetes"]);
			expect(result.diagnostics).toEqual([]);
		});

		it("applies the same rule to sequence participants", () => {
			const result = placeNodeLogos(
				[
					{ id: "worker", label: "Cloudflare Worker", icon: { slug: "cloudflare" } },
					{ id: "queue", label: "Job queue", icon: { slug: "aws" } },
				],
				vendors,
				"participant",
			);

			expect(icons(result.nodes)).toEqual(["cloudflare", undefined]);
			expect(result.diagnostics).toEqual([
				'icon_dropped: participant "queue" logo "aws" is a vendor logo, but its label "Job queue" does not name AWS.',
			]);
		});
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
