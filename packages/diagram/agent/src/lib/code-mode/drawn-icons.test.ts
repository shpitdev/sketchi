import { drawnIconSlug, ICON_RECIPE_LIMITS, type IconRecipe } from "@sketchi/diagram-core";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts";
import { RenderedDiagramSceneSchema } from "./contract";
import {
	CodeModeIconLoadError,
	drawnIconsIn,
	makeCodeModeIconCatalog,
	type CodeModeCommunityIcon,
} from "./icons";
import {
	applyDiagramPatch,
	buildFlowchart,
	buildSequenceDiagram,
	CodeModeRuntimeEnvironment,
	createCanvas,
	editFlowchart,
	makeCodeModeRuntimeEnvironmentLayer,
	searchIcons,
} from "./runtime";

const ACME: IconRecipe = {
	parts: [
		{ kind: "rect", x: 3, y: 3, width: 18, height: 18, rounded: true, fill: "#e8590c" },
		{ kind: "text", cx: 12, cy: 12, text: "A", size: 12, color: "paper" },
	],
};
/** What sketchi.drawIcon resolves to, judge and usage included. */
const DRAWN = {
	ok: true,
	status: "drawn",
	name: "Acme",
	recipe: ACME,
	judge: { recognizable: true },
	palette: [["#e8590c", 0.6]],
	author: { model: "author", rounds: 1 },
	usage: { calls: 2, ms: 9000 },
};
const ACME_SLUG = drawnIconSlug(ACME);

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>';

function catalogIcon(slug: string, name: string, variant?: string) {
	return {
		aliases: [],
		bytes: 400,
		collection: "cloud-hosting-paas",
		colorMode: "multicolor" as const,
		keywords: variant ? [slug, "wordmark"] : [slug],
		name,
		slug,
		svgPath: `/${slug}.svg`,
		viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		...(variant ? { variant } : {}),
	};
}

function catalog() {
	return makeCodeModeIconCatalog({
		icons: [
			catalogIcon("vercel", "Vercel"),
			catalogIcon("vercel-text", "Vercel Wordmark", "text"),
			catalogIcon("acme-cloud", "Acme Cloud"),
		],
		loadSvg: (icon) =>
			icon.slug === "vercel" || icon.slug === "vercel-text"
				? Effect.succeed(SVG)
				: Effect.fail(
						CodeModeIconLoadError.make({
							cause: new Error("missing"),
							message: `No source for ${icon.slug}.`,
							slug: icon.slug,
						}),
					),
		slugLookup: "sketchi.searchIcons({ q })",
		wordmarks: true,
	});
}

// Newest first, as the store pages them.
const PUBLISHED: readonly CodeModeCommunityIcon[] = [
	{ slug: "community/acme-cloud-old", name: "Acme Cloud old", recipe: ACME },
	{ slug: "community/acme", name: "Acme", recipe: ACME },
];

function runtime() {
	const storage = makeMemoryArtifactStorage();
	let id = 0;
	const environment = makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-${(id += 1)}`,
		icons: catalog(),
		communityIcons: {
			load: (slugs) => Effect.succeed(PUBLISHED.filter((icon) => slugs.includes(icon.slug))),
			search: (query) =>
				Effect.succeed(
					PUBLISHED.filter((icon) => icon.name.toLowerCase().includes(query.toLowerCase())),
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
		applyDiagramPatch: (input: unknown) => provide(applyDiagramPatch(input)),
		buildFlowchart: (input: unknown) => provide(buildFlowchart(input)),
		buildSequenceDiagram: (input: unknown) => provide(buildSequenceDiagram(input)),
		createCanvas: (input: unknown) => provide(createCanvas(input)),
		editFlowchart: (input: unknown) => provide(editFlowchart(input)),
		searchIcons: (input: unknown) => provide(searchIcons(input)),
	};
}

function inlineScene(result: {
	readonly artifact?: { readonly formats: ReadonlyArray<{ format: string; inline?: unknown }> };
}) {
	const inline = result.artifact?.formats.find(({ format }) => format === "scene")?.inline;
	return Schema.decodeUnknownSync(RenderedDiagramSceneSchema)(inline);
}

function canvas(elements: readonly unknown[]) {
	return {
		spec: {
			kind: "canvas",
			version: 1,
			diagramId: "stack",
			title: "Stack",
			width: 480,
			height: 240,
			accentColor: "#1f2937",
			backgroundColor: "#ffffff",
			elements,
		},
	};
}

describe("drawn icons", () => {
	it("key a recipe by its content, whatever its key order", () => {
		const reordered = {
			parts: ACME.parts.map((part) => Object.fromEntries(Object.entries(part).reverse())),
		} as unknown as IconRecipe;
		expect(drawnIconSlug(reordered)).toBe(ACME_SLUG);
		expect(ACME_SLUG).toMatch(/^drawn\/[0-9a-f]{16}$/u);
		expect(drawnIconsIn({ nodes: { a: { icon: DRAWN } } }).get(ACME_SLUG)).toEqual({
			slug: ACME_SLUG,
			name: "Acme",
			recipe: ACME,
		});
		expect(drawnIconsIn({ icon: { recipe: { parts: [] } } }).size).toBe(0);
	});

	it("draw a drawIcon result on a flowchart node, unpublished, and keep it through an edit", async () => {
		const run = runtime();
		const result = await run.buildFlowchart({
			spec: {
				title: "Deploy",
				nodes: { build: "Build", ship: { label: "Ship with Acme", icon: DRAWN } },
				edges: [["build", "ship"]],
			},
		});
		expect(result.ok ? result.issues : result.issues).toEqual([]);
		if (!result.ok) return;
		expect((result.normalizedSpec.nodes["ship"] as { icon?: unknown }).icon).toBe(ACME_SLUG);
		expect(inlineScene(result).icons?.[ACME_SLUG]).toEqual({ name: "Acme", recipe: ACME });

		const edited = await run.editFlowchart({
			artifactId: result.artifact.artifactId,
			edits: [{ op: "set", nodes: { build: "Build image" } }],
		});
		expect(edited.ok ? [] : edited.issues).toEqual([]);
		if (!edited.ok) return;
		expect(inlineScene(edited).icons?.[ACME_SLUG]?.recipe).toEqual(ACME);
	});

	it("still build when a drawing failed, and say why the node draws no icon", async () => {
		const run = runtime();
		const result = await run.buildFlowchart({
			spec: {
				title: "Deploy",
				nodes: {
					build: "Build",
					ship: {
						label: "Ship",
						icon: { ok: false, status: "rate_limited", issues: [] },
					},
				},
				edges: [["build", "ship"]],
			},
		});
		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				ref: expect.objectContaining({ id: "ship" }),
				message: expect.stringContaining("neither a slug nor a recipe"),
			}),
		]);
	});

	it("refuse a recipe past the checker's limits instead of embedding it", async () => {
		const run = runtime();
		const tooMany = {
			name: "Busy",
			recipe: {
				parts: Array.from({ length: ICON_RECIPE_LIMITS.maxParts + 1 }, () => ACME.parts[0]),
			},
		};
		const result = await run.buildSequenceDiagram({
			spec: {
				title: "Login",
				participants: [
					{ id: "user", label: "User" },
					{ id: "api", label: "Busy API", icon: tooMany },
				],
				messages: [{ source: "user", target: "api", label: "Sign in" }],
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(inlineScene(result).icons).toBeUndefined();
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				message: expect.stringContaining(`1-${ICON_RECIPE_LIMITS.maxParts} parts`),
			}),
		]);
	});

	it("draw on a sequence participant", async () => {
		const run = runtime();
		const result = await run.buildSequenceDiagram({
			spec: {
				title: "Login",
				participants: [
					{ id: "user", label: "User" },
					{ id: "api", label: "Acme API", icon: DRAWN },
				],
				messages: [{ source: "user", target: "api", label: "Sign in" }],
			},
		});
		expect(result.ok ? result.issues : result.issues).toEqual([]);
		if (!result.ok) return;
		expect(result.normalizedSpec.participants[1]?.icon).toEqual({ slug: ACME_SLUG });
		expect(inlineScene(result).icons?.[ACME_SLUG]?.recipe).toEqual(ACME);
	});
});

describe("standalone icon elements", () => {
	it("place a catalog mark, a wordmark and a drawn icon on a canvas, and keep them through a patch", async () => {
		const run = runtime();
		const result = await run.createCanvas(
			canvas([
				{ type: "icon", id: "vercel", slug: "vercel", x: 20, y: 20, width: 48, height: 48 },
				{ type: "icon", id: "word", slug: "vercel-text", x: 100, y: 20, width: 160, height: 48 },
				{ type: "icon", id: "acme", ...DRAWN, x: 300, y: 20, width: 48, height: 48 },
				{
					type: "node",
					id: "app",
					nodeId: "app",
					shape: "rectangle",
					x: 20,
					y: 120,
					width: 184,
					height: 96,
					label: "App",
					icon: { ...DRAWN, size: 28 },
				},
			]),
		);
		expect(result.ok ? result.issues : result.issues).toEqual([]);
		if (!result.ok) return;
		const scene = inlineScene(result);
		expect(Object.keys(scene.icons ?? {}).sort()).toEqual([ACME_SLUG, "vercel", "vercel-text"]);
		expect(scene.icons?.["vercel-text"]?.svg).toContain("<svg");
		expect(scene.elements.find((element) => element.id === "acme")).toMatchObject({
			type: "icon",
			slug: ACME_SLUG,
		});
		expect(
			result.normalizedSpec.elements.find((element) => element.id === "acme"),
		).not.toHaveProperty("recipe");

		const patched = await run.applyDiagramPatch({
			source: { artifactId: result.artifact.artifactId },
			operations: [{ op: "translate", selector: { ids: ["acme"] }, dx: 10, dy: 0 }],
		});
		expect(patched.ok ? patched.issues : patched.issues).toEqual([]);
		if (!patched.ok) return;
		const after = inlineScene(patched);
		expect(after.icons?.[ACME_SLUG]?.recipe).toEqual(ACME);
		expect(after.elements.find((element) => element.id === "acme")).toMatchObject({ x: 310 });
	});

	it("remove an icon element that cannot draw, with its zOrder and layout entries", async () => {
		const run = runtime();
		const result = await run.createCanvas({
			spec: {
				...canvas([]).spec,
				elements: [
					{ type: "icon", id: "gone", slug: "nope", x: 20, y: 20, width: 48, height: 48 },
					{ type: "icon", id: "failed", ok: false, x: 80, y: 20, width: 48, height: 48 },
					{ type: "icon", id: "vercel", slug: "vercel", x: 140, y: 20, width: 48, height: 48 },
				],
				layouts: [{ type: "row", ids: ["gone", "failed", "vercel"] }],
				zOrder: ["gone", "failed", "vercel"],
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const scene = inlineScene(result);
		expect(scene.elements.map((element) => element.id)).toEqual(["vercel"]);
		expect(scene.zOrder).toEqual(["vercel"]);
		expect(scene.layouts).toEqual([{ type: "row", ids: ["vercel"] }]);
		expect(result.issues.map((entry) => [entry.code, entry.ref?.id])).toEqual([
			["icon_dropped", "failed"],
			["unknown_icon", "gone"],
		]);
	});

	it("keep wordmarks out of nodes", async () => {
		const run = runtime();
		const result = await run.createCanvas(
			canvas([
				{
					type: "node",
					id: "app",
					nodeId: "app",
					shape: "rectangle",
					x: 20,
					y: 20,
					width: 184,
					height: 96,
					label: "Vercel",
					icon: { slug: "vercel-text", size: 28 },
				},
			]),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(inlineScene(result).icons).toBeUndefined();
		expect(result.issues).toEqual([expect.objectContaining({ code: "unknown_icon" })]);
	});
});

describe("searchIcons", () => {
	it("lists community icons after curated marks, and wordmarks only when asked", async () => {
		const run = runtime();
		const acme = await run.searchIcons({ q: "acme cloud" });
		expect(
			acme.ok && acme.icons.map(({ slug, collection, match }) => [slug, collection, match]),
		).toEqual([
			["acme-cloud", "cloud-hosting-paas", "exact"],
			["community/acme-cloud-old", "community", "weak"],
		]);
		const exact = await run.searchIcons({ q: "Acme" });
		expect(exact.ok && exact.icons.map(({ slug, match }) => [slug, match])).toEqual([
			["community/acme", "exact"],
			["acme-cloud", "weak"],
			["community/acme-cloud-old", "weak"],
		]);
		const top = await run.searchIcons({ q: "Acme", limit: 1 });
		expect(top.ok && top.icons.map(({ slug }) => slug)).toEqual(["community/acme"]);
		const bySlug = await run.searchIcons({ q: "community/acme" });
		expect(bySlug.ok && bySlug.icons.map(({ slug, match }) => [slug, match])).toEqual([
			["community/acme", "exact"],
			["community/acme-cloud-old", "weak"],
		]);
		const vercel = await run.searchIcons({ q: "vercel" });
		expect(vercel.ok && vercel.icons.map(({ slug }) => slug)).toEqual(["vercel"]);
		const wordmark = await run.searchIcons({ q: "vercel wordmark" });
		expect(wordmark.ok && wordmark.icons.map(({ slug }) => slug)).toEqual(["vercel-text"]);
	});
});
