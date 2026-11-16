import { buildResponse } from "../../operation.js";
import {
	CanvasSpec,
	drawnIconSlug,
	ICON_RECIPE_LIMITS,
	iconRecipeIssues,
	type IconRecipe,
} from "@sketchi/drawing";
import { iconRecipeElements } from "@sketchi/drawing/excalidraw";
import type { SketchiIcon } from "@sketchi/icon-catalog";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import { CONCEPT_ICONS } from "@sketchi/icon-catalog/concepts";
import nativeIcons from "@sketchi/icon-catalog/native-icons";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../artifacts";
import {
	CodeModeIconLoadError,
	makeCodeModeIconCatalog,
	withCommunityIcons,
	type CodeModeCommunityIcon,
	type CodeModeIconCatalog,
} from "../icons";
import {
	buildFlowchart,
	buildSequenceDiagram,
	type CodeModeArtifactRenderer,
	CodeModeRuntimeEnvironment,
	createCanvas,
	editFlowchart,
	getArtifact,
	makeCodeModeRuntimeEnvironmentLayer,
} from "../runtime";

function catalogIcon(
	slug: string,
	name: string,
	overrides: Partial<SketchiIcon> = {},
): SketchiIcon {
	return {
		aliases: [],
		bytes: 400,
		collection: "devtools-ci",
		colorMode: "multicolor",
		keywords: slug.split("-"),
		name,
		slug,
		svgPath: `/output/upload-ready/svg/devtools-ci/${slug}.svg`,
		viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		...overrides,
	};
}

const SOURCES: Record<string, string> = {
	docker: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>',
	github: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle r="1"/></svg>',
};

function fixtureCatalog(): CodeModeIconCatalog {
	return makeCodeModeIconCatalog({
		icons: [catalogIcon("docker", "Docker"), catalogIcon("github", "GitHub")],
		slugLookup: "sketchi.searchIcons({ q })",
		loadSvg: (icon) => {
			const source = SOURCES[icon.slug];
			return source
				? Effect.succeed(source)
				: Effect.fail(
						CodeModeIconLoadError.make({
							cause: new Error("missing"),
							message: `No source for ${icon.slug}.`,
							slug: icon.slug,
						}),
					);
		},
	});
}

const RING: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9, stroke: "#e8590c" },
		{ kind: "text", cx: 12, cy: 12, text: "Q", size: 8 },
	],
};

const COMMUNITY: readonly CodeModeCommunityIcon[] = [
	{ slug: "community/ring-queue", name: "Ring queue", recipe: RING },
];

function runtime(
	options: {
		readonly icons?: CodeModeIconCatalog;
		readonly renderer?: CodeModeArtifactRenderer;
	} = {},
) {
	const storage = makeMemoryArtifactStorage();
	const loads: string[][] = [];
	let id = 0;
	const environment = makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-${(id += 1)}`,
		icons: options.icons ?? fixtureCatalog(),
		...(options.renderer ? { renderer: options.renderer } : {}),
		communityIcons: {
			load: (slugs) =>
				Effect.sync(() => {
					loads.push([...slugs]);
					return COMMUNITY.filter((icon) => slugs.includes(icon.slug));
				}),
			search: () => Effect.succeed([]),
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
		buildFlowchart: (input: unknown) => provide(buildResponse(buildFlowchart(input))),
		buildSequenceDiagram: (input: unknown) => provide(buildResponse(buildSequenceDiagram(input))),
		createCanvas: (input: unknown) => provide(createCanvas(input)),
		editFlowchart: (input: unknown) => provide(editFlowchart(input)),
		getArtifact: (input: unknown) => provide(getArtifact(input)),
	};
}

function deploySpec(icons: Record<string, string>) {
	const node = (id: string, label: string) => (icons[id] ? { label, icon: icons[id] } : label);
	return {
		title: "Deploy pipeline",
		nodes: {
			push: node("push", "Push to GitHub"),
			build: node("build", "Build the Docker image"),
			ship: node("ship", "Ship to production"),
		},
		edges: [
			["push", "build"],
			["build", "ship"],
		],
	};
}

type FlowchartBuild = Awaited<ReturnType<ReturnType<typeof runtime>["buildFlowchart"]>>;

/** The logo each node draws, in node order, from the document as built. */
function nodeLogos(result: FlowchartBuild): unknown[] {
	if (!result.ok) throw new Error(JSON.stringify(result.issues));
	return Object.values(result.normalizedSpec.nodes).map((node) =>
		typeof node === "string" ? undefined : node.icon,
	);
}

function inlineScene(result: {
	readonly artifact?: {
		readonly formats: ReadonlyArray<{ format: string; inline?: unknown }>;
	};
}) {
	const inline = result.artifact?.formats.find(({ format }) => format === "scene")?.inline;
	return Schema.decodeUnknownSync(CanvasSpec)(inline);
}

describe("catalog icons", () => {
	it("resolves an icon by slug or product name and drops one that names no logo", async () => {
		const result = await runtime().buildFlowchart({
			spec: deploySpec({ push: "GitHub", build: "docker", ship: "zzz-not-a-logo" }),
		});

		expect(nodeLogos(result)).toEqual(["github", "docker", undefined]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				severity: "warning",
				ref: { kind: "node", id: "ship", path: "nodes.ship.icon" },
			}),
		]);
	});

	it("returns slugs and references, not image bytes, when nothing is inlined", async () => {
		const svgCount = (value: unknown) => JSON.stringify(value).split("<svg").length - 1;
		const dataUrlCount = (value: unknown) => JSON.stringify(value).split("data:image/").length - 1;
		const rendered: unknown[] = [];
		const icons = runtime({
			renderer: {
				renderPng: (input) => {
					rendered.push(input);
					return Effect.succeed(new Uint8Array([137, 80, 78, 71]));
				},
			},
		});
		const result = await icons.buildFlowchart({
			spec: deploySpec({ push: "github", build: "docker", ship: "docker" }),
			options: { artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] },
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(svgCount(result)).toBe(0);
		expect(dataUrlCount(result)).toBe(0);
		expect(result.artifact.formats.some((format) => "inline" in format)).toBe(false);

		// The stored artifacts and the PNG renderer still get every logo, each image once.
		const scene = await icons.getArtifact({
			artifactId: result.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		if (!scene.ok) throw new Error(JSON.stringify(scene.issues));
		expect(Object.keys(inlineScene({ artifact: { formats: [scene] } }).icons ?? {}).sort()).toEqual(
			["docker", "github"],
		);
		const excalidraw = await icons.getArtifact({
			artifactId: result.artifact.artifactId,
			format: "excalidraw",
			inline: true,
		});
		if (!excalidraw.ok) throw new Error(JSON.stringify(excalidraw.issues));
		const file = excalidraw.inline as { elements: { type: string }[]; files: object };
		expect(file.elements.filter((element) => element.type === "image")).toHaveLength(3);
		expect(dataUrlCount(file.files)).toBe(2);
		expect(rendered).toHaveLength(1);
		expect(svgCount(rendered[0])).toBeGreaterThanOrEqual(2);
	});

	it("replaces authored image data on a canvas with normalized catalog assets", async () => {
		const result = await runtime().createCanvas({
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "logos",
				title: "Logos",
				width: 600,
				height: 300,
				accentColor: "#1f2937",
				backgroundColor: "#ffffff",
				elements: ["push", "build"].map((id, index) => ({
					type: "node",
					id,
					nodeId: id,
					shape: "rectangle",
					x: 40 + index * 220,
					y: 40,
					width: 184,
					height: 96,
					label: id,
					icon: { slug: id === "push" ? "github" : "Docker", size: 28 },
				})),
				icons: { docker: { name: "Forged", svg: "<svg onload=alert(1)>" } },
			},
			options: { inlineArtifacts: ["scene"] },
		});

		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(result.issues).toEqual([]);
		expect(inlineScene(result).icons).toEqual({
			github: {
				name: "GitHub",
				svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle r="1"/></svg>',
			},
			docker: {
				name: "Docker",
				svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>',
			},
		});
	});
});

describe("named logo fill", () => {
	const production = () =>
		runtime({
			icons: makeCodeModeIconCatalog({
				icons: iconManifest.icons,
				slugLookup: "sketchi.searchIcons({ q })",
				loadSvg: () => Effect.succeed(SOURCES["docker"] ?? ""),
			}),
		});

	function chain(nodes: ReadonlyArray<readonly [string, string]>, logos: boolean) {
		return {
			title: "Stack",
			...(logos ? { logos: true } : {}),
			nodes: Object.fromEntries(nodes),
			edges: nodes.slice(1).map(([id], index) => [nodes[index]?.[0], id]),
		};
	}

	const labels = [
		["push", "Push to GitHub"],
		["page", "Next.js page (Vercel) receives the question"],
		["image", "Docker image pushed to GitHub"],
		["go", "Go to checkout"],
		["rust", "Rust service"],
		["mail", "Send Mail"],
		["stream", "Stream events"],
		["notion", "Notion of done"],
		["sentry", "Log errors to Sentry"],
		["tests", "Test suite runs"],
	] as const;

	it("draws the first product a label names, and never fills a step word or an unnamed label", async () => {
		const result = await production().buildFlowchart({ spec: chain(labels, true) });

		expect(nodeLogos(result)).toEqual([
			"github",
			"nextjs",
			"docker",
			undefined,
			"rust",
			undefined,
			undefined,
			undefined,
			"sentry",
			undefined,
		]);
	});

	it("draws no logo the document does not ask for", async () => {
		const result = await production().buildFlowchart({ spec: chain(labels, false) });

		expect(nodeLogos(result).filter(Boolean)).toEqual([]);
	});
});

describe("community and drawn icons", () => {
	it("adds community icons under their namespace without shadowing the catalog", () => {
		const extended = withCommunityIcons(fixtureCatalog(), [
			...COMMUNITY,
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
	});

	it("resolves a flowchart node's community slug and draws it by recipe", async () => {
		const run = runtime();
		const result = await run.buildFlowchart({
			spec: {
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
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(run.loads).toEqual([["community/ring-queue", "community/missing"]]);
		expect(nodeLogos(result)).toEqual(["community/ring-queue", "docker", undefined]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				ref: expect.objectContaining({ id: "gone" }),
			}),
		]);
		expect(inlineScene(result).icons?.["community/ring-queue"]).toEqual({
			name: "Ring queue",
			recipe: RING,
		});
	});

	const ACME: IconRecipe = {
		parts: [
			{ kind: "rect", x: 3, y: 3, width: 18, height: 18, rounded: true, fill: "#e8590c" },
			{ kind: "text", cx: 12, cy: 12, text: "A", size: 12, color: "paper" },
		],
	};
	const ACME_SLUG = drawnIconSlug(ACME);

	it("draws a drawIcon result on a flowchart node, unpublished, and keeps it through an edit", async () => {
		const run = runtime();
		const result = await run.buildFlowchart({
			spec: {
				title: "Deploy",
				nodes: {
					build: "Build",
					ship: {
						label: "Ship with Acme",
						icon: { ok: true, status: "drawn", name: "Acme", recipe: ACME },
					},
				},
				edges: [["build", "ship"]],
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(result.issues).toEqual([]);
		expect(nodeLogos(result)).toEqual([undefined, ACME_SLUG]);
		expect(inlineScene(result).icons?.[ACME_SLUG]).toEqual({ name: "Acme", recipe: ACME });

		const edited = await run.editFlowchart({
			artifactId: result.artifact.artifactId,
			edits: [{ op: "set", nodes: { build: "Build image" } }],
		});
		if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
		expect(inlineScene(edited).icons?.[ACME_SLUG]?.recipe).toEqual(ACME);
	});

	it("refuses a recipe past the checker's limits instead of embedding it", async () => {
		const tooMany = {
			name: "Busy",
			recipe: {
				parts: Array.from({ length: ICON_RECIPE_LIMITS.maxParts + 1 }, () => ACME.parts[0]),
			},
		};
		const result = await runtime().buildSequenceDiagram({
			spec: {
				title: "Login",
				participants: [
					{ id: "user", label: "User" },
					{ id: "api", label: "Busy API", icon: tooMany },
				],
				messages: [{ source: "user", target: "api", label: "Sign in" }],
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(inlineScene(result).icons).toBeUndefined();
		expect(result.issues).toEqual([expect.objectContaining({ code: "icon_dropped" })]);
	});

	it("keeps every shipped recipe drawable, for a concept or a catalog mark, within the icon budget", () => {
		// The draw engine's 8 parts are the real budget; the bytes are the rough-path points
		// Excalidraw stores at node-logo size, so a drawn brand mark runs to about 6 KB.
		const marks = new Set(iconManifest.icons.map((icon) => icon.slug));
		const concepts = new Set(CONCEPT_ICONS.map((concept) => concept.slug));
		for (const slug of concepts) expect(Object.hasOwn(nativeIcons, slug), slug).toBe(true);
		for (const [slug, recipe] of Object.entries(nativeIcons)) {
			expect(concepts.has(slug) || marks.has(slug), slug).toBe(true);
			expect(iconRecipeIssues(recipe), slug).toEqual([]);
			const parts = iconRecipeElements(recipe as IconRecipe, {
				box: { x: 0, y: 0, size: 28 },
				id: `${slug}-icon`,
				groupIds: [`node:${slug}:logo`],
				ink: "#1e1e1e",
				paper: "#ffffff",
				customData: { sketchiNodeIcon: slug },
			});
			expect(parts.length, slug).toBeLessThanOrEqual(8);
			expect(new TextEncoder().encode(JSON.stringify(parts)).byteLength, slug).toBeLessThanOrEqual(
				6 * 1024,
			);
		}
	});
});
