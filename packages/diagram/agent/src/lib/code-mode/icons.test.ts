import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { SketchiIcon } from "@sketchi/icon-catalog";

import { makeMemoryArtifactStorage, CodeModeArtifactStorage } from "./artifacts";
import { RenderedDiagramSceneSchema } from "./contract";
import { CodeModeIconLoadError, makeCodeModeIconCatalog, type CodeModeIconCatalog } from "./icons";
import {
	applyDiagramPatch,
	buildFlowchart,
	CodeModeRuntimeEnvironment,
	createCanvas,
	makeCodeModeRuntimeEnvironmentLayer,
	searchIcons,
} from "./runtime";

function catalogIcon(
	slug: string,
	name: string,
	overrides: Partial<SketchiIcon> = {},
): SketchiIcon {
	return {
		aliases: [],
		bytes: 400,
		collection: "devtools-ci",
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
		icons: [
			catalogIcon("docker", "Docker"),
			catalogIcon("github", "GitHub"),
			catalogIcon("broken", "Broken"),
			catalogIcon("github-text", "GitHub Wordmark", { variant: "text" }),
			catalogIcon("tanstack", "TanStack", { bytes: 498_897 }),
		],
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

function runtime(icons: CodeModeIconCatalog | null = fixtureCatalog()) {
	const storage = makeMemoryArtifactStorage();
	let id = 0;
	const environment = makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-${(id += 1)}`,
		...(icons ? { icons } : {}),
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
		createCanvas: (input: unknown) => provide(createCanvas(input)),
		searchIcons: (input: unknown) => provide(searchIcons(input)),
	};
}

function deploySpec(icons: Record<string, string>) {
	const node = (id: string, label: string, kind: string) => ({
		id,
		label,
		kind,
		...(icons[id] ? { icon: { slug: icons[id] } } : {}),
	});
	return {
		title: "Deploy pipeline",
		nodes: [
			node("push", "Push to GitHub", "start"),
			node("build", "Build the Docker image", "process"),
			node("ship", "Ship to production", "end"),
		],
		edges: [
			{ source: "push", target: "build" },
			{ source: "build", target: "ship" },
		],
	};
}

function canvasSpec(
	nodes: ReadonlyArray<{
		readonly height?: number;
		readonly id: string;
		readonly icon?: unknown;
	}>,
	extra: Record<string, unknown> = {},
) {
	return {
		kind: "canvas",
		version: 1,
		diagramId: "logos",
		title: "Logos",
		width: 600,
		height: 300,
		accentColor: "#1f2937",
		backgroundColor: "#ffffff",
		elements: nodes.map((entry, index) => ({
			type: "node",
			id: entry.id,
			nodeId: entry.id,
			shape: "rectangle",
			x: 40 + index * 220,
			y: 40,
			width: 184,
			height: entry.height ?? 96,
			label: entry.id,
			...(entry.icon ? { icon: entry.icon } : {}),
		})),
		...extra,
	};
}

function inlineScene(result: {
	readonly ok: boolean;
	readonly artifact?: {
		readonly formats: ReadonlyArray<{ format: string; inline?: unknown }>;
	};
}) {
	const inline = result.artifact?.formats.find(({ format }) => format === "scene")?.inline;
	return Schema.decodeUnknownSync(RenderedDiagramSceneSchema)(inline);
}

describe("Code Mode icon catalog", () => {
	it("exposes only compact non-wordmark marks", () => {
		const catalog = fixtureCatalog();
		expect(catalog.get("docker")).toEqual({
			collection: "devtools-ci",
			name: "Docker",
			slug: "docker",
		});
		expect(catalog.get("github-text")).toBeUndefined();
		expect(catalog.get("tanstack")).toBeUndefined();
		expect(catalog.search("git", 5).map((icon) => icon.slug)).toEqual(["github"]);
	});
});

describe("buildFlowchart icons", () => {
	it("keeps catalog slugs and drops unknown ones with an unknown_icon warning", async () => {
		const result = await runtime().buildFlowchart({
			spec: deploySpec({
				push: "GitHub",
				build: "docker-engine",
				ship: "github-text",
			}),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.normalizedSpec.nodes.map((node) => node.icon)).toEqual([
			{ slug: "github" },
			undefined,
			undefined,
		]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				severity: "warning",
				ref: { kind: "node", id: "build", path: "nodes.icon.slug" },
				hint: 'Use an exact slug, for example "docker" (Docker), or look one up with sketchi.searchIcons({ q }).',
			}),
			expect.objectContaining({
				code: "unknown_icon",
				severity: "warning",
				ref: { kind: "node", id: "ship", path: "nodes.icon.slug" },
			}),
		]);
	});

	it("treats prototype-member slugs as unknown", async () => {
		const result = await runtime().buildFlowchart({
			spec: deploySpec({ push: "constructor", build: "__proto__" }),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.normalizedSpec.nodes.map((node) => node.icon)).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		expect(result.issues.map((entry) => entry.code)).toEqual(["unknown_icon", "unknown_icon"]);
	});

	it("drops every icon with a warning when the host has no catalog", async () => {
		const result = await runtime(null).buildFlowchart({
			spec: deploySpec({ push: "github" }),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.normalizedSpec.nodes[0]?.icon).toBeUndefined();
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				hint: expect.stringContaining("no icon catalog"),
			}),
		]);
	});
});

describe("createCanvas icons", () => {
	it("embeds normalized catalog assets and replaces authored ones", async () => {
		const result = await runtime().createCanvas({
			spec: canvasSpec(
				[
					{ id: "push", icon: { slug: "github", size: 28 } },
					{ id: "build", icon: { slug: "Docker", size: 28 } },
					{ id: "also", icon: { slug: "docker", size: 24 } },
				],
				{ icons: { docker: { name: "Forged", svg: "<svg onload=alert(1)>" } } },
			),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues).toEqual([]);
		expect("icons" in result.normalizedSpec).toBe(false);
		const scene = inlineScene(result);
		expect(scene.icons).toEqual({
			github: {
				name: "GitHub",
				svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle r="1"/></svg>',
			},
			docker: {
				name: "Docker",
				svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>',
			},
		});
		expect(
			scene.elements.map((element) => (element.type === "node" ? element.icon : undefined)),
		).toEqual([
			{ slug: "github", size: 28 },
			{ slug: "docker", size: 28 },
			{ slug: "docker", size: 24 },
		]);
	});

	it("drops unknown and unloadable icons with warnings and still builds", async () => {
		const result = await runtime().createCanvas({
			spec: canvasSpec([
				{ id: "made-up", icon: { slug: "made-up-logo", size: 28 } },
				{ id: "broken", icon: { slug: "broken", size: 28 } },
			]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				ref: { kind: "element", id: "made-up", path: "elements[0].icon.slug" },
				message: expect.stringContaining("is not a Sketchi node logo"),
			}),
			expect.objectContaining({
				code: "icon_dropped",
				ref: { kind: "element", id: "broken", path: "elements[1].icon.slug" },
				message: expect.stringContaining("could not be loaded"),
			}),
		]);
		const scene = inlineScene(result);
		expect(scene.icons).toBeUndefined();
		expect(scene.elements.some((element) => element.type === "node" && element.icon)).toBe(false);
	});

	it("drops a logo that leaves no room for its label instead of failing", async () => {
		const result = await runtime().createCanvas({
			// A one-line label fits a 60px node alone but not under a 28px logo.
			spec: canvasSpec([{ id: "tight", height: 60, icon: { slug: "docker", size: 28 } }]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				severity: "warning",
				ref: { kind: "element", id: "tight", path: "elements[0].icon" },
				hint: expect.stringContaining("36px taller"),
			}),
		]);
		const scene = inlineScene(result);
		expect(scene.elements[0]).not.toHaveProperty("icon");
		expect(scene.icons).toBeUndefined();
	});

	it("treats prototype-member slugs as unknown logos", async () => {
		const result = await runtime().createCanvas({
			spec: canvasSpec([
				{ id: "a", icon: { slug: "constructor", size: 28 } },
				{ id: "b", icon: { slug: "toString", size: 28 } },
			]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues.map((entry) => entry.code)).toEqual(["unknown_icon", "unknown_icon"]);
		expect(inlineScene(result).icons).toBeUndefined();
	});

	it("rejects icon sizes outside the supported range", async () => {
		const result = await runtime().createCanvas({
			spec: canvasSpec([{ id: "huge", icon: { slug: "docker", size: 200 } }]),
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
	});
});

describe("applyDiagramPatch icons", () => {
	it("drops a patched-in logo that does not fit instead of failing", async () => {
		const icons = runtime();
		const built = await icons.createCanvas({
			spec: canvasSpec([{ id: "tight", height: 60 }]),
			options: { inlineArtifacts: ["scene"] },
		});
		const source = inlineScene(built);
		const tight = source.elements.find((element) => element.id === "tight");
		const patched = await icons.applyDiagramPatch({
			source: { scene: source },
			operations: [
				{
					op: "replace",
					id: "tight",
					element: { ...tight, icon: { slug: "docker", size: 28 } },
				},
			],
			options: { inlineArtifacts: ["scene"] },
		});

		expect(patched.ok).toBe(true);
		if (!patched.ok) return;
		expect(patched.issues).toEqual([
			expect.objectContaining({ code: "icon_dropped", severity: "warning" }),
		]);
		expect(
			inlineScene(patched).elements.find((element) => element.id === "tight"),
		).not.toHaveProperty("icon");
	});

	it("moves logos with their node and re-derives assets for inline scenes", async () => {
		const icons = runtime();
		const built = await icons.createCanvas({
			spec: canvasSpec([{ id: "push", icon: { slug: "github", size: 28 } }]),
			options: { inlineArtifacts: ["scene"] },
		});
		const source = inlineScene(built);
		const patched = await icons.applyDiagramPatch({
			source: {
				scene: {
					...source,
					icons: { github: { name: "Forged", svg: "<svg/>" } },
				},
			},
			operations: [{ op: "translate", selector: { nodeIds: ["push"] }, dx: 30, dy: 0 }],
			options: { inlineArtifacts: ["scene"] },
		});

		expect(patched.ok).toBe(true);
		if (!patched.ok) return;
		const scene = inlineScene(patched);
		const node = scene.elements.find((element) => element.id === "push");
		expect(node).toMatchObject({ x: 70, icon: { slug: "github", size: 28 } });
		expect(scene.icons?.["github"]?.name).toBe("GitHub");
	});
});

describe("searchIcons", () => {
	it("returns ranked node logos for a query", async () => {
		const result = await runtime().searchIcons({ q: "  Git ", limit: 5 });

		expect(result).toEqual({
			ok: true,
			status: "accepted",
			query: "Git",
			icons: [{ collection: "devtools-ci", name: "GitHub", slug: "github" }],
			issues: [],
		});
	});

	it("rejects malformed requests with input issues", async () => {
		const result = await runtime().searchIcons({ limit: 500 });

		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(result.issues.map((entry) => entry.ref?.path)).toEqual(
			expect.arrayContaining(["q", "limit"]),
		);
	});

	it("returns no logos with a warning when the host has no catalog", async () => {
		const result = await runtime(null).searchIcons({ q: "docker" });

		expect(result).toMatchObject({ ok: true, icons: [] });
		expect(result.issues).toEqual([
			expect.objectContaining({ code: "unknown_icon", severity: "warning" }),
		]);
	});
});
