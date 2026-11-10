import type { IconRecipe } from "@sketchi/diagram-core";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts";
import { RenderedDiagramSceneSchema } from "./contract";
import {
	CodeModeIconLoadError,
	communityIconSlugsIn,
	makeCodeModeIconCatalog,
	withCommunityIcons,
	type CodeModeCommunityIcon,
} from "./icons";
import {
	buildFlowchart,
	CodeModeRuntimeEnvironment,
	createCanvas,
	editFlowchart,
	makeCodeModeRuntimeEnvironmentLayer,
} from "./runtime";

const RING: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9, stroke: "#e8590c" },
		{ kind: "text", cx: 12, cy: 12, text: "Q", size: 8 },
	],
};
const DOCKER_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>';

function catalog() {
	return makeCodeModeIconCatalog({
		icons: [
			{
				aliases: [],
				bytes: 400,
				collection: "devtools-ci",
				colorMode: "multicolor",
				keywords: ["docker"],
				name: "Docker",
				slug: "docker",
				svgPath: "/docker.svg",
				viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
			},
		],
		loadSvg: (icon) =>
			icon.slug === "docker"
				? Effect.succeed(DOCKER_SVG)
				: Effect.fail(
						CodeModeIconLoadError.make({
							cause: new Error("missing"),
							message: `No source for ${icon.slug}.`,
							slug: icon.slug,
						}),
					),
		slugLookup: "sketchi.searchIcons({ q })",
	});
}

const PUBLISHED: readonly CodeModeCommunityIcon[] = [
	{ slug: "community/ring-queue", name: "Ring queue", recipe: RING },
];

function runtime(published = PUBLISHED) {
	const loads: string[][] = [];
	const storage = makeMemoryArtifactStorage();
	let id = 0;
	const environment = makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-${(id += 1)}`,
		icons: catalog(),
		communityIcons: {
			load: (slugs) =>
				Effect.sync(() => {
					loads.push([...slugs]);
					return published.filter((icon) => slugs.includes(icon.slug));
				}),
			search: (query) =>
				Effect.sync(() =>
					published.filter((icon) => icon.name.toLowerCase().includes(query.toLowerCase())),
				),
		},
	});
	const provide = <A>(
		program: Effect.Effect<A, never, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	) =>
		Effect.runPromise(
			program.pipe(
				Effect.provide(environment),
				Effect.provideService(CodeModeArtifactStorage, storage),
			),
		);
	return {
		loads,
		buildFlowchart: (input: unknown) => provide(buildFlowchart(input)),
		createCanvas: (input: unknown) => provide(createCanvas(input)),
		editFlowchart: (input: unknown) => provide(editFlowchart(input)),
	};
}

function sceneIcons(result: {
	readonly ok: boolean;
	readonly artifact?: { readonly formats: ReadonlyArray<{ format: string; inline?: unknown }> };
}) {
	const inline = result.artifact?.formats.find(({ format }) => format === "scene")?.inline;
	return Schema.decodeUnknownSync(RenderedDiagramSceneSchema)(inline).icons ?? {};
}

describe("community icon slugs", () => {
	it("finds every community slug a request names, once, and nothing else", () => {
		expect(
			communityIconSlugsIn({
				nodes: {
					a: { label: "A", icon: " Community/Ring-Queue " },
					b: { label: "B", icon: "docker" },
					c: "community/not a slug",
				},
				elements: [{ icon: { slug: "community/ring-queue" } }, { icon: { slug: "community/box" } }],
			}),
		).toEqual(["community/ring-queue", "community/box"]);
		expect(communityIconSlugsIn({ title: "No icons" })).toEqual([]);
	});

	it("adds community icons under their namespace without shadowing the catalog", () => {
		const base = catalog();
		const extended = withCommunityIcons(base, [
			...PUBLISHED,
			{ slug: "docker", name: "Not Docker", recipe: RING },
			{ slug: "community/broken", name: "Broken", recipe: { parts: [] } },
		]);
		expect(extended.get("community/ring-queue")).toEqual({
			collection: "community",
			name: "Ring queue",
			slug: "community/ring-queue",
		});
		expect(extended.recipe("community/ring-queue")).toEqual(RING);
		expect(extended.get("docker")?.name).toBe("Docker");
		expect(extended.recipe("docker")).toBeUndefined();
		expect(extended.get("community/broken")).toBeUndefined();
		expect(extended.search("ring", 5)).toEqual([]);
	});
});

describe("diagrams draw community icons", () => {
	const spec = {
		title: "Jobs",
		nodes: {
			queue: { label: "Job queue", icon: "community/ring-queue" },
			worker: { label: "Docker worker", icon: "docker" },
			gone: { label: "Archive", icon: "community/missing" },
		},
		edges: [
			["queue", "worker"],
			["worker", "gone"],
		],
	};

	it("resolves a flowchart node's community slug and draws it by recipe", async () => {
		const run = runtime();
		const result = await run.buildFlowchart({ spec });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(run.loads).toEqual([["community/ring-queue", "community/missing"]]);
		const nodes = result.normalizedSpec.nodes as Record<string, { icon?: string }>;
		expect(nodes["queue"]?.icon).toBe("community/ring-queue");
		expect(nodes["gone"]?.icon).toBeUndefined();
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				ref: expect.objectContaining({ id: "gone" }),
			}),
		]);
		const icons = sceneIcons(result);
		expect(icons["community/ring-queue"]).toEqual({ name: "Ring queue", recipe: RING });
	});

	it("keeps a community icon through a flowchart edit", async () => {
		const run = runtime();
		const built = await run.buildFlowchart({ spec });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const edited = await run.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [{ op: "set", nodes: { worker: "Docker runner" } }],
		});
		expect(edited.ok ? [] : edited.issues).toEqual([]);
		if (!edited.ok) return;
		const nodes = edited.normalizedSpec.nodes as Record<string, { icon?: string }>;
		expect(nodes["queue"]?.icon).toBe("community/ring-queue");
		expect(sceneIcons(edited)["community/ring-queue"]?.recipe).toEqual(RING);
	});

	it("draws a canvas node's community icon and asks the store nothing for catalog slugs", async () => {
		const run = runtime();
		const result = await run.createCanvas({
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "logos",
				title: "Logos",
				width: 400,
				height: 200,
				accentColor: "#1f2937",
				backgroundColor: "#ffffff",
				elements: [
					{
						type: "node",
						id: "queue",
						nodeId: "queue",
						shape: "rectangle",
						x: 40,
						y: 40,
						width: 184,
						height: 96,
						label: "Queue",
						icon: { slug: "community/ring-queue", size: 28, exact: true },
					},
				],
			},
		});
		expect(result.ok ? [] : result.issues).toEqual([]);
		expect(sceneIcons(result)["community/ring-queue"]).toEqual({
			name: "Ring queue",
			recipe: RING,
		});

		const catalogOnly = runtime();
		await catalogOnly.buildFlowchart({
			spec: { title: "One", nodes: { a: { label: "Docker", icon: "docker" } }, edges: [] },
		});
		expect(catalogOnly.loads).toEqual([]);
	});
});
