import { CodeModeArtifactStorageMemory } from "@sketchi/diagrams/build/code-mode/artifacts";
import { makeCodeModeRuntimeEnvironmentLayer } from "@sketchi/diagrams/build/code-mode/runtime";
import nativeIcons from "@sketchi/icon-catalog/native-icons";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { PNG } from "pngjs";

import { DiagramBuilder, DiagramBuilderLive } from "../src/builder.js";
import { cliIconCatalog } from "../src/icon-catalog.js";
import { CliPngRenderer, CliPngRendererLive } from "../src/png-renderer.js";
import { canonicalDocument, flowchartInput, mindmapInput, sequenceInput } from "./fixtures.js";

const builderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({
				createId: (prefix) => `${prefix}_png_test`,
				icons: cliIconCatalog,
			}),
		),
	),
);

/** One document per canonical family: document in, valid PNG out. */
const familyDocuments: ReadonlyArray<unknown> = [
	flowchartInput,
	mindmapInput,
	sequenceInput,
	// state-machine
	{
		type: "state-machine",
		spec: {
			title: "Media player",
			initial: "stopped",
			states: [
				{ id: "stopped", label: "Stopped" },
				{ id: "active", label: "Active", initial: "playing" },
				{ id: "playing", label: "Playing", parent: "active" },
				{ id: "paused", label: "Paused", parent: "active" },
			],
			transitions: [
				{ source: "stopped", target: "active", event: "play" },
				{ source: "playing", target: "paused", event: "pause" },
				{ source: "paused", target: "playing", event: "resume" },
				{ source: "active", target: "stopped", event: "stop" },
			],
		},
	},
	// er
	{
		type: "er",
		spec: {
			title: "Org chart",
			entities: [
				{
					id: "employees",
					fields: ["id int PK", "manager_id int? FK", "department_id int FK"],
				},
				{ id: "departments", fields: ["id int PK", "name text UK"] },
			],
			relationships: [
				{
					from: "employees.manager_id",
					to: "employees.id",
					fromCardinality: "zero-or-many",
					toCardinality: "zero-or-one",
				},
				{
					from: "employees.department_id",
					to: "departments.id",
					fromCardinality: "one-or-many",
					toCardinality: "one",
				},
			],
		},
	},
	// sankey
	{
		type: "sankey",
		spec: {
			title: "Cloud budget",
			unit: "$k",
			nodes: [
				{ id: "eng", label: "Engineering" },
				{ id: "compute", label: "Compute" },
				{ id: "storage", label: "Storage" },
			],
			links: [
				{ source: "eng", target: "compute", value: 310 },
				{ source: "eng", target: "storage", value: 2 },
			],
		},
	},
	// wireframe
	{
		type: "wireframe",
		spec: {
			title: "Signup",
			screens: [
				{
					name: "Sign up",
					device: "mobile",
					children: [
						{ type: "heading", text: "Create account" },
						{ type: "input", label: "Email", placeholder: "you@example.com" },
						{ type: "toggle", label: "Send me updates", checked: true },
						{ type: "button", text: "Continue", variant: "primary" },
					],
				},
				{
					name: "Welcome",
					device: "mobile",
					children: [
						{ type: "image", label: "Welcome art" },
						{ type: "text", lines: 2 },
					],
				},
			],
		},
	},
	// org-chart
	{
		type: "org-chart",
		spec: {
			title: "Startup team",
			people: [
				{ id: "ceo", name: "Ada Lovelace", title: "CEO", avatar: true },
				{
					id: "ea",
					name: "Grace Hopper",
					title: "Assistant",
					manager: "ceo",
					assistant: true,
				},
				{ id: "cto", name: "Alan Turing", title: "CTO", manager: "ceo" },
				{ id: "cpo", name: "Radia Perlman", title: "CPO", manager: "ceo" },
				{ id: "dev", name: "Ken Thompson", title: "Engineer", manager: "cto" },
			],
			dottedLines: [{ report: "dev", manager: "cpo" }],
		},
	},
	// venn
	{
		type: "venn",
		spec: {
			title: "iOS vs Android",
			sets: [
				{ id: "ios", label: "iOS" },
				{ id: "android", label: "Android" },
			],
			regions: [
				{ sets: ["ios"], items: ["Apple Pay"] },
				{ sets: ["android"], items: ["Google Pay"] },
				{ sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] },
			],
		},
	},
	// journey
	{
		type: "journey",
		spec: {
			title: "Online purchase",
			persona: "Maya, a first-time buyer",
			stages: [
				{ name: "Discover", steps: [{ label: "Sees an ad", score: 4 }] },
				{
					name: "Buy",
					steps: [
						{ label: "Creates an account", score: 2, touchpoint: "Website" },
						{ label: "Pays by card", score: 5, touchpoint: "Website" },
					],
					painPoints: ["Forced account creation"],
				},
			],
		},
	},
	// class
	{
		type: "class",
		spec: {
			title: "Shapes",
			classes: [
				{ id: "Shape", kind: "abstract", methods: ["+ area(): double {abstract}"] },
				{ id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] },
				{ id: "Canvas", methods: ["+ add(shape: Shape): void"] },
			],
			relationships: [
				{ kind: "inheritance", from: "Circle", to: "Shape" },
				{
					kind: "aggregation",
					from: "Canvas",
					to: "Shape",
					fromMultiplicity: "1",
					toMultiplicity: "0..*",
				},
			],
		},
	},
	// chart
	{
		type: "chart",
		spec: {
			id: "browser-share",
			title: "Browser share",
			kind: "pie",
			categories: ["Chrome", "Safari", "Other"],
			series: [{ values: [64, 19, 17] }],
			unit: "%",
		},
	},
	// gantt
	{
		type: "gantt",
		spec: {
			id: "release-plan",
			title: "Release plan",
			tasks: [
				{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06" },
				{
					id: "build",
					label: "Build",
					start: "2026-03-09",
					duration: 5,
					dependsOn: ["design"],
				},
				{
					id: "ship",
					label: "Ship",
					start: "2026-03-16",
					milestone: true,
					dependsOn: ["build"],
				},
			],
		},
	},
	// quadrant
	{
		type: "quadrant",
		spec: {
			id: "backlog",
			title: "Backlog: effort vs impact",
			xAxis: { title: "Effort", low: "Low effort", high: "High effort" },
			yAxis: { title: "Impact", low: "Low impact", high: "High impact" },
			quadrants: {
				topLeft: "Quick wins",
				topRight: "Major projects",
				bottomLeft: "Fill-ins",
				bottomRight: "Thankless tasks",
			},
			points: [
				{ label: "Single sign-on", x: 0.3, y: 0.85 },
				{ label: "Admin role templates", x: 0.5, y: 0.6 },
			],
		},
	},
	// timeline
	{
		type: "timeline",
		spec: {
			id: "launch-plan",
			title: "Launch plan",
			today: "2026-03-10",
			lanes: ["Product", "Marketing"],
			events: [
				{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29", lane: "Product" },
				{ id: "ga", label: "GA", date: "2026-08-04", kind: "milestone", lane: "Product" },
				{ id: "blog", label: "Launch blog", date: "2026-08", lane: "Marketing" },
			],
		},
	},
];

function inkBounds(bytes: Uint8Array) {
	const png = PNG.sync.read(Buffer.from(bytes));
	const background = [...png.data.subarray(0, 4)];
	let minX = png.width;
	let minY = png.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < png.height; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const offset = (y * png.width + x) * 4;
			if (
				png.data[offset] === background[0] &&
				png.data[offset + 1] === background[1] &&
				png.data[offset + 2] === background[2] &&
				png.data[offset + 3] === background[3]
			) {
				continue;
			}
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	assert.isAtLeast(maxX, 0, "PNG must contain visible ink");
	return { width: png.width, height: png.height, minX, minY, maxX, maxY };
}

function assertInkHasPadding(bytes: Uint8Array): void {
	const bounds = inkBounds(bytes);
	const minimumPadding = 16;
	assert.isAtLeast(bounds.minX, minimumPadding);
	assert.isAtLeast(bounds.minY, minimumPadding);
	assert.isAtMost(bounds.maxX, bounds.width - minimumPadding - 1);
	assert.isAtMost(bounds.maxY, bounds.height - minimumPadding - 1);
}

const logoFlowchart = {
	type: "flowchart",
	spec: {
		id: "deploy-logos",
		title: "Deploy pipeline",
		nodes: {
			push: { label: "Push to GitHub", icon: "github" },
			build: { label: "Build the Docker image", icon: "docker" },
			tests: { label: "Tests pass?", icon: "vitest" },
			fix: "Fix the failing tests",
			ship: { label: "Ship to Cloudflare", icon: "cloudflare" },
		},
		edges: [
			["push", "build"],
			["build", "tests"],
			["tests", "ship", "yes"],
			["tests", "fix", "no"],
			["fix", "build"],
		],
	},
} as const;

/** Brand fills in the catalog SVGs; the Sketchi palette uses none of them. */
const BRAND_COLORS = {
	cloudflare: [0xf3, 0x80, 0x20],
	docker: [0x24, 0x96, 0xed],
	vitest: [0x72, 0x9b, 0x1b],
} as const;

function brandPixelCounts(bytes: Uint8Array) {
	const png = PNG.sync.read(Buffer.from(bytes));
	const counts = { cloudflare: 0, docker: 0, vitest: 0 };
	for (let offset = 0; offset < png.data.length; offset += 4) {
		for (const [slug, [red, green, blue]] of Object.entries(BRAND_COLORS)) {
			if (
				Math.abs((png.data[offset] ?? 0) - red) <= 12 &&
				Math.abs((png.data[offset + 1] ?? 0) - green) <= 12 &&
				Math.abs((png.data[offset + 2] ?? 0) - blue) <= 12
			) {
				counts[slug as keyof typeof counts] += 1;
			}
		}
	}
	return counts;
}

layer(Layer.mergeAll(builderLayer, CliPngRendererLive))("headless PNG export", (it) => {
	it.effect("exports every canonical family as a padded PNG", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const types = new Set<string>();
			for (const input of familyDocuments) {
				const built = yield* builder.build(canonicalDocument(input));
				types.add(built.type);
				const png = yield* renderer.renderPng({ scene: built.scene, excalidraw: built.excalidraw });
				assert.deepStrictEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
				assertInkHasPadding(png);
			}
			assert.strictEqual(types.size, familyDocuments.length);
		}),
	);

	it.effect("rasterizes every node logo into the PNG", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(canonicalDocument(logoFlowchart));
			// Marks with a recipe draw by hand; the rest embed their SVG as one image each.
			const slugs = ["github", "docker", "vitest", "cloudflare"];
			const embedded = slugs.filter((slug) => !Object.hasOwn(nativeIcons, slug));
			const images = built.excalidraw.elements.filter((element) => element["type"] === "image");
			assert.lengthOf(images, embedded.length);
			assert.lengthOf(Object.keys(built.excalidraw.files), embedded.length);

			const png = yield* renderer.renderPng({
				scene: built.scene,
				excalidraw: built.excalidraw,
			});
			const counts = brandPixelCounts(png);
			// Logos are 20-28px squares at 2x export scale. Thresholds are about
			// half of each mark's smallest measured brand-color area (Docker 804,
			// Cloudflare 372, Vitest green 102), so a clipped or missing logo fails.
			assert.isAbove(counts.docker, 400, "Docker mark painted");
			assert.isAbove(counts.cloudflare, 180, "Cloudflare mark painted");
			assert.isAbove(counts.vitest, 50, "Vitest mark painted");
		}),
	);

	it.effect("fails closed when a drawing exceeds the raster ceiling", () =>
		Effect.gen(function* () {
			const builder = yield* DiagramBuilder;
			const renderer = yield* CliPngRenderer;
			const built = yield* builder.build(canonicalDocument(flowchartInput));
			const [first] = built.excalidraw.elements;
			const huge = { ...first, id: "huge", x: 0, y: 0, width: 40_000, height: 40_000, angle: 0 };
			const failure = yield* Effect.flip(
				renderer.renderPng({
					excalidraw: { ...built.excalidraw, elements: [...built.excalidraw.elements, huge] },
				}),
			);
			assert.strictEqual(failure.code, "render_limit_exceeded");
		}),
	);
});
