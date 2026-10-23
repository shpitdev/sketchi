import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { SketchiIcon } from "@sketchi/icon-catalog";
import { iconManifest } from "@sketchi/icon-catalog/catalog";

import { makeMemoryArtifactStorage, CodeModeArtifactStorage } from "./artifacts";
import { RenderedDiagramSceneSchema } from "./contract";
import { CodeModeIconLoadError, makeCodeModeIconCatalog, type CodeModeIconCatalog } from "./icons";
import {
	applyDiagramPatch,
	buildFlowchart,
	buildSequenceDiagram,
	type CodeModeArtifactRenderer,
	CodeModeRuntimeEnvironment,
	createCanvas,
	getArtifact,
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
	cloudflare:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 1h1"/></svg>',
	aws: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 2h1"/></svg>',
	kubernetes:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 3h1"/></svg>',
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
			catalogIcon("cloudflare", "Cloudflare", { collection: "cloud-vendors" }),
			catalogIcon("aws", "AWS", {
				aliases: ["AWS", "amazon", "amazon web services"],
				collection: "cloud-vendors",
			}),
			catalogIcon("kubernetes", "Kubernetes", { aliases: ["Kubernetes", "k8s", "kube"] }),
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

function runtime(
	icons: CodeModeIconCatalog | null = fixtureCatalog(),
	renderer?: CodeModeArtifactRenderer,
	policy: { readonly fillNamedLogos?: boolean } = {},
) {
	const storage = makeMemoryArtifactStorage();
	let id = 0;
	const environment = makeCodeModeRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}-${(id += 1)}`,
		...(icons ? { icons } : {}),
		...(renderer ? { renderer } : {}),
		...policy,
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
		getArtifact: (input: unknown) => provide(getArtifact(input)),
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

describe("logo payloads in build results", () => {
	// Two nodes share the docker logo, so each image may appear once, not per node.
	const spec = deploySpec({ push: "github", build: "docker", ship: "docker" });
	const svgCount = (value: unknown) => JSON.stringify(value).split("<svg").length - 1;
	const dataUrlCount = (value: unknown) => JSON.stringify(value).split("data:image/").length - 1;

	it("returns slugs and references, not image bytes, when nothing is inlined", async () => {
		const rendered: unknown[] = [];
		const icons = runtime(fixtureCatalog(), {
			renderPng: (input) => {
				rendered.push(input);
				return Effect.succeed(new Uint8Array([137, 80, 78, 71]));
			},
		});
		const result = await icons.buildFlowchart({
			spec,
			options: { artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] },
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(svgCount(result)).toBe(0);
		expect(dataUrlCount(result)).toBe(0);
		expect(result.artifact.formats.map((format) => "inline" in format)).toEqual([
			false,
			false,
			false,
		]);
		expect(result.normalizedSpec.nodes.map((node) => node.icon?.slug)).toEqual([
			"github",
			"docker",
			"docker",
		]);

		// The stored artifacts and the PNG renderer still get every logo.
		const scene = await icons.getArtifact({
			artifactId: result.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		if (!scene.ok) throw new Error(JSON.stringify(scene.issues));
		expect(
			Object.keys(inlineScene({ ok: true, artifact: { formats: [scene] } }).icons ?? {}).sort(),
		).toEqual(["docker", "github"]);
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

	it.each([
		["the default scene", undefined, svgCount],
		["scene", ["scene"], svgCount],
		["excalidraw", ["excalidraw"], dataUrlCount],
	] as const)("inlines each image once for %s", async (_name, inlineArtifacts, count) => {
		const result = await runtime().buildFlowchart({
			spec,
			options: {
				artifactFormats: ["scene", "excalidraw"],
				...(inlineArtifacts ? { inlineArtifacts } : {}),
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(count(result)).toBe(2);
		expect(svgCount(result) + dataUrlCount(result)).toBe(2);
	});
});

describe("vendor logos", () => {
	function stackSpec(nodes: ReadonlyArray<readonly [string, string, string]>) {
		return {
			title: "Stack",
			nodes: nodes.map(([id, label, slug], index) => ({
				id,
				label,
				kind: index === 0 ? "start" : index === nodes.length - 1 ? "end" : "process",
				icon: { slug },
			})),
			edges: nodes.slice(1).map(([id], index) => ({ source: nodes[index]?.[0], target: id })),
		};
	}

	it("keeps a vendor logo on a node whose label names the vendor", async () => {
		const result = await runtime().buildFlowchart({
			spec: stackSpec([
				["push", "Push to GitHub", "github"],
				["ship", "Ship to Cloudflare Workers", "cloudflare"],
				["fn", "AWS Lambda", "aws"],
			]),
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(result.normalizedSpec.nodes.map((node) => node.icon?.slug)).toEqual([
			"github",
			"cloudflare",
			"aws",
		]);
		expect(result.issues).toEqual([]);
	});

	it("drops a vendor logo from a node whose label does not name the vendor", async () => {
		const result = await runtime().buildFlowchart({
			spec: stackSpec([
				["ingress", "Ingress controller", "kubernetes"],
				["build", "Build the image", "docker"],
				["s3", "S3 bucket", "aws"],
			]),
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(result.normalizedSpec.nodes.map((node) => node.icon?.slug)).toEqual([
			undefined,
			"docker",
			undefined,
		]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				severity: "warning",
				ref: { kind: "node", id: "ingress", path: "nodes.icon.slug" },
				message: expect.stringContaining('label "Ingress controller" does not name Kubernetes'),
			}),
			expect.objectContaining({
				code: "icon_dropped",
				ref: { kind: "node", id: "s3", path: "nodes.icon.slug" },
				message: expect.stringContaining('label "S3 bucket" does not name AWS'),
			}),
		]);
	});

	it("applies the same rule to sequence participants", async () => {
		const result = await runtime().buildSequenceDiagram({
			spec: {
				title: "Deploy webhook",
				participants: [
					{ id: "github", label: "GitHub", icon: { slug: "github" } },
					{ id: "worker", label: "Cloudflare Worker", icon: { slug: "cloudflare" } },
					{ id: "queue", label: "Job queue", icon: { slug: "aws" } },
				],
				messages: [
					{ source: "github", target: "worker", label: "Push webhook" },
					{ source: "worker", target: "queue", label: "Enqueue" },
				],
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(result.normalizedSpec.participants.map((participant) => participant.icon?.slug)).toEqual(
			["github", "cloudflare", undefined],
		);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				ref: { kind: "node", id: "queue", path: "participants.icon.slug" },
				message: expect.stringContaining('participant "queue"'),
			}),
		]);
	});
});

describe("named logo fill", () => {
	const productionCatalog = makeCodeModeIconCatalog({
		icons: iconManifest.icons,
		slugLookup: "sketchi.searchIcons({ q })",
		loadSvg: () => Effect.succeed(SOURCES["docker"] ?? ""),
	});
	const filling = () => runtime(productionCatalog, undefined, { fillNamedLogos: true });

	// Frontierclimb r20 deploy-pipeline-logos s1: the model drew GitHub and
	// Docker but left Cloudflare off "Ship to Cloudflare Workers".
	const r20DeploySpec = {
		title: "Deploy pipeline",
		nodes: [
			{ id: "push", label: "Push to GitHub", kind: "start", icon: { slug: "github" } },
			{ id: "build", label: "Docker builds the image", kind: "process", icon: { slug: "docker" } },
			{ id: "tests", label: "Test suite runs", kind: "process" },
			{ id: "pass", label: "Tests pass?", kind: "decision" },
			{ id: "deploy", label: "Ship to Cloudflare Workers", kind: "end" },
			{ id: "notify", label: "Notify the team and stop", kind: "end" },
		],
		edges: [
			{ source: "push", target: "build" },
			{ source: "build", target: "tests" },
			{ source: "tests", target: "pass" },
			{ source: "pass", target: "deploy", label: "Yes" },
			{ source: "pass", target: "notify", label: "No" },
		],
		layout: { direction: "TB" },
	};

	function chain(nodes: ReadonlyArray<readonly [string, string, string?]>) {
		return {
			title: "Stack",
			nodes: nodes.map(([id, label, slug], index) => ({
				id,
				label,
				kind: index === 0 ? "start" : index === nodes.length - 1 ? "end" : "process",
				...(slug ? { icon: { slug } } : {}),
			})),
			edges: nodes.slice(1).map(([id], index) => ({ source: nodes[index]?.[0], target: id })),
		};
	}

	const slugs = (result: Awaited<ReturnType<ReturnType<typeof runtime>["buildFlowchart"]>>) => {
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		return result.normalizedSpec.nodes.map((node) => node.icon?.slug);
	};

	it("gives a logo-less node the vendor logo its label names when the diagram draws logos", async () => {
		const result = await filling().buildFlowchart({ spec: r20DeploySpec });

		expect(slugs(result)).toEqual([
			"github",
			"docker",
			undefined,
			undefined,
			"cloudflare",
			undefined,
		]);
		expect(result.issues).toEqual([
			{
				code: "icon_filled",
				severity: "info",
				stage: "input",
				ref: { kind: "node", id: "deploy", path: "nodes.icon.slug" },
				message:
					'Node "deploy" draws the "cloudflare" logo because its label "Ship to Cloudflare Workers" names Cloudflare.',
				hint: "No action needed.",
			},
		]);
	});

	it("leaves a diagram without logos without logos", async () => {
		const spec = {
			...r20DeploySpec,
			nodes: r20DeploySpec.nodes.map(({ icon: _icon, ...node }) => node),
		};
		const result = await filling().buildFlowchart({ spec });

		expect(slugs(result).filter(Boolean)).toEqual([]);
		expect(result.issues).toEqual([]);
	});

	it("does not count a dropped logo as one the diagram draws", async () => {
		const result = await filling().buildFlowchart({
			spec: chain([
				["push", "Push to GitHub", "not-a-logo"],
				["ship", "Ship to Cloudflare Workers"],
			]),
		});

		expect(slugs(result)).toEqual([undefined, undefined]);
		expect(result.issues.map((issue) => issue.code)).toEqual(["unknown_icon"]);
	});

	it("keeps the logo the model chose, and fills no node it gave a logo", async () => {
		const result = await filling().buildFlowchart({
			spec: chain([
				["push", "Push to GitHub", "github"],
				["build", "Build with Docker", "github"],
				["ship", "Ship to Cloudflare Workers", "not-a-logo"],
			]),
		});

		expect(slugs(result)).toEqual(["github", "github", undefined]);
		expect(result.issues.map((issue) => issue.code)).toEqual(["unknown_icon"]);
	});

	it("never fills ambiguous, everyday-word, or unnamed labels", async () => {
		const result = await filling().buildFlowchart({
			spec: chain([
				["push", "Push to GitHub", "github"],
				["page", "Next.js page (Vercel) receives the question"],
				["image", "Docker image pushed to GitHub"],
				["go", "Go to checkout"],
				["rust", "Rust service"],
				["mail", "Send Mail"],
				["stream", "Stream events"],
				["notion", "Notion of done"],
				["sentry", "Log errors to Sentry"],
				["tests", "Test suite runs"],
			]),
		});

		expect(slugs(result)).toEqual(["github", ...Array.from({ length: 9 }, () => undefined)]);
		expect(result.issues).toEqual([]);
	});

	it("only fills when the host asks, as MCP builds do", async () => {
		const result = await runtime(productionCatalog).buildFlowchart({ spec: r20DeploySpec });

		expect(slugs(result)[4]).toBeUndefined();
		expect(result.issues).toEqual([]);
	});

	it("fills sequence participants the same way", async () => {
		const result = await filling().buildSequenceDiagram({
			spec: {
				title: "Deploy webhook",
				participants: [
					{ id: "developer", label: "Developer" },
					{ id: "github", label: "GitHub", icon: { slug: "github" } },
					{ id: "worker", label: "Cloudflare Worker" },
					{ id: "docker", label: "Docker", icon: { slug: "docker" } },
				],
				messages: [
					{ source: "developer", target: "github", label: "Push commit" },
					{ source: "github", target: "worker", label: "Push webhook" },
					{ source: "worker", target: "docker", label: "Build image" },
				],
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(result.normalizedSpec.participants.map((participant) => participant.icon?.slug)).toEqual(
			[undefined, "github", "cloudflare", "docker"],
		);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_filled",
				severity: "info",
				ref: { kind: "node", id: "worker", path: "participants.icon.slug" },
				message:
					'Participant "worker" draws the "cloudflare" logo because its label "Cloudflare Worker" names Cloudflare.',
			}),
		]);
	});

	describe("flowchart groups", () => {
		// Frontierclimb r23 ai-app-stack-logos s4 (Sonnet): the model drew Next.js,
		// Redis, OpenAI and Sentry logos but left its "Vercel" group a bare name.
		const r23AppSpec = {
			title: "Request flow",
			nodes: [
				{
					id: "page",
					label: "Next.js page receives the question",
					kind: "start",
					icon: { slug: "nextjs" },
					group: "vercel",
				},
				{
					id: "check",
					label: "Check Redis cache",
					kind: "process",
					icon: { slug: "redis" },
					group: "vercel",
				},
				{ id: "hit", label: "Cache hit?", kind: "decision", group: "vercel" },
				{ id: "call", label: "Call OpenAI model", kind: "process", icon: { slug: "openai" } },
				{ id: "store", label: "Store answer in Redis", kind: "process", icon: { slug: "redis" } },
				{ id: "log", label: "Log any errors to Sentry", kind: "process", icon: { slug: "sentry" } },
				{ id: "ret", label: "Return the answer", kind: "end" },
				{ id: "cached", label: "Return cached answer", kind: "end" },
			],
			edges: [
				{ source: "page", target: "check" },
				{ source: "check", target: "hit" },
				{ source: "hit", target: "cached", label: "yes" },
				{ source: "hit", target: "call", label: "no" },
				{ source: "call", target: "store" },
				{ source: "store", target: "log" },
				{ source: "log", target: "ret" },
			],
			groups: [{ id: "vercel", label: "Vercel" }],
			layout: { direction: "TB" },
		};
		const options = {
			artifactFormats: ["scene", "excalidraw"],
			inlineArtifacts: ["scene", "excalidraw"],
		};

		/** Each drawn group's logo slug by group id, from the scene's frames and zones. */
		function groupLogos(result: Awaited<ReturnType<ReturnType<typeof runtime>["buildFlowchart"]>>) {
			if (!result.ok) throw new Error(JSON.stringify(result.issues));
			const scene = inlineScene(result);
			return Object.fromEntries(
				scene.elements.flatMap((element) =>
					(element.type === "frame" ||
						(element.type === "node" && element.rendererRole === "zone")) &&
					element.icon
						? [[element.id.slice("group:".length), element.icon.slug]]
						: [],
				),
			);
		}

		/** A logo-drawing chain of nodes inside the given groups. */
		function grouped(
			groups: ReadonlyArray<{ id: string; label: string; parent?: string; kind?: string }>,
			nodes: ReadonlyArray<readonly [string, string, string | undefined, string?]>,
		) {
			const spec = chain(
				nodes.map(([id, label, slug]) => (slug ? ([id, label, slug] as const) : [id, label])),
			);
			return {
				...spec,
				nodes: spec.nodes.map((node, index) => {
					const group = nodes[index]?.[3];
					return group ? { ...node, group } : node;
				}),
				groups,
			};
		}

		it("draws the logo a group's label names before its name, with an info note", async () => {
			const result = await filling().buildFlowchart({ spec: r23AppSpec, options });

			expect(groupLogos(result)).toEqual({ vercel: "vercel" });
			expect(result.issues).toEqual([
				{
					code: "icon_filled",
					severity: "info",
					stage: "input",
					ref: { kind: "group", id: "vercel" },
					message:
						'Group "vercel" draws the "vercel" logo because its label "Vercel" names Vercel.',
					hint: "No action needed.",
				},
			]);
			if (!result.ok) return;
			// The spec the model wrote stays as written: groups take no authored logo.
			expect(result.normalizedSpec.groups).toEqual([{ id: "vercel", label: "Vercel" }]);
			const scene = inlineScene(result);
			expect(Object.keys(scene.icons ?? {})).toContain("vercel");
			const frame = scene.elements.find((element) => element.id === "group:vercel");
			const excalidraw = result.artifact.formats.find((format) => format.format === "excalidraw")
				?.inline as {
				elements: Array<{
					customData?: Record<string, unknown>;
					frameId: string | null;
					groupIds: string[];
					type: string;
					x: number;
					y: number;
					width: number;
				}>;
			};
			const logo = excalidraw.elements.find(
				(element) => element.customData?.["sketchiGroupIcon"] === "vercel",
			);
			// Inside the frame's top-left corner, one of its children, so it moves with the frame.
			expect(frame?.type).toBe("frame");
			if (frame?.type !== "frame") return;
			expect(logo).toMatchObject({
				type: "image",
				frameId: "group:vercel",
				groupIds: [],
				x: frame.x + 10,
				y: frame.y + 10,
				width: 18,
			});
			// Members and routes keep clear of it.
			const keepOut = { x: frame.x + 6, y: frame.y + 6, width: 26, height: 26 };
			for (const element of scene.elements) {
				if (element.type === "node")
					expect(
						element.x >= keepOut.x + keepOut.width || element.y >= keepOut.y + keepOut.height,
					).toBe(true);
				if (element.type === "arrow")
					for (const point of element.points)
						expect(
							point.x >= keepOut.x + keepOut.width ||
								point.y >= keepOut.y + keepOut.height ||
								point.x <= keepOut.x ||
								point.y <= keepOut.y,
						).toBe(true);
			}
		});

		it("draws a zone's logo in its header, its label after it", async () => {
			const spec = {
				...r23AppSpec,
				groups: [{ id: "vercel", label: "Vercel", kind: "cloud" }],
			};
			const result = await filling().buildFlowchart({ spec, options });

			expect(groupLogos(result)).toEqual({ vercel: "vercel" });
			if (!result.ok) return;
			const scene = inlineScene(result);
			const zone = scene.elements.find((element) => element.id === "group:vercel");
			const label = scene.elements.find((element) => element.id === "zone-label:vercel");
			if (zone?.type !== "node" || label?.type !== "text") throw new Error("Expected a zone.");
			const excalidraw = result.artifact.formats.find((format) => format.format === "excalidraw")
				?.inline as {
				elements: Array<{
					customData?: Record<string, unknown>;
					groupIds: string[];
					id: string;
					x: number;
					y: number;
				}>;
			};
			const logo = excalidraw.elements.find(
				(element) => element.customData?.["sketchiGroupIcon"] === "vercel",
			);
			expect(logo).toMatchObject({ x: zone.x + 12, y: zone.y + 9 });
			// It shares the zone's group, so the two move together.
			const outline = excalidraw.elements.find((element) => element.id === "group:vercel");
			expect(outline?.groupIds[0]).toBeDefined();
			expect(logo?.groupIds).toEqual(outline?.groupIds);
			// The label starts after the logo and its gap.
			const plain = await filling().buildFlowchart({
				spec: { ...spec, nodes: spec.nodes.map(({ icon: _icon, ...node }) => node) },
				options,
			});
			if (!plain.ok) throw new Error(JSON.stringify(plain.issues));
			const plainLabel = inlineScene(plain).elements.find(
				(element) => element.id === "zone-label:vercel",
			);
			const plainZone = inlineScene(plain).elements.find(
				(element) => element.id === "group:vercel",
			);
			if (plainLabel?.type !== "text" || plainZone?.type !== "node") throw new Error("No zone.");
			expect(label.x - zone.x - (plainLabel.x - plainZone.x)).toBe(24);
		});

		it("never fills a group in a diagram that draws no logo", async () => {
			const spec = {
				...r23AppSpec,
				nodes: r23AppSpec.nodes.map(({ icon: _icon, ...node }) => node),
			};
			const result = await filling().buildFlowchart({ spec, options });

			expect(groupLogos(result)).toEqual({});
			expect(result.issues).toEqual([]);
		});

		it("never fills a group whose label names several products or an everyday word", async () => {
			const result = await filling().buildFlowchart({
				spec: grouped(
					[
						{ id: "both", label: "Vercel and Cloudflare" },
						{ id: "front", label: "Frontend" },
						{ id: "edge", label: "Edge" },
						{ id: "stream", label: "Stream processing" },
					],
					[
						["push", "Push to GitHub", "github", "both"],
						["page", "Render the page", undefined, "front"],
						["route", "Route the request", undefined, "edge"],
						["events", "Process events", undefined, "stream"],
					],
				),
				options,
			});

			expect(groupLogos(result)).toEqual({});
			expect(result.issues).toEqual([]);
		});

		it("never repeats a logo a node inside the group, or a group around it, already draws", async () => {
			const result = await filling().buildFlowchart({
				spec: grouped(
					[
						{ id: "cf", label: "Cloudflare", kind: "cloud" },
						{ id: "aws", label: "AWS", kind: "cloud" },
						{ id: "region", label: "AWS us-east-1", parent: "aws", kind: "region" },
					],
					[
						["push", "Push to GitHub", "github"],
						["worker", "Cloudflare Workers", "cloudflare", "cf"],
						["queue", "Enqueue the job", undefined, "region"],
					],
				),
				options,
			});

			expect(groupLogos(result)).toEqual({ aws: "aws" });
			expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
				["icon_filled", "aws"],
			]);
		});

		it("only fills when the host asks, as MCP builds do", async () => {
			const result = await runtime(productionCatalog).buildFlowchart({
				spec: r23AppSpec,
				options,
			});

			expect(groupLogos(result)).toEqual({});
			expect(result.issues).toEqual([]);
		});
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
			icons: [{ collection: "devtools-ci", name: "GitHub", slug: "github", match: "weak" }],
			issues: [],
		});
	});

	it("tags each result with how it answers the query", async () => {
		const tagged = async (q: string) => {
			const result = await runtime().searchIcons({ q });
			if (!result.ok) throw new Error(`searchIcons rejected ${q}.`);
			return result.icons.map(({ match, slug }) => [slug, match]);
		};

		expect(await tagged("GitHub")).toEqual([["github", "exact"]]);
		expect(await tagged("git")).toEqual([["github", "weak"]]);
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

describe("sequence participant logos", () => {
	const spec = {
		title: "Deploy webhook",
		participants: [
			{ id: "developer", label: "Developer" },
			{ id: "github", label: "GitHub", icon: { slug: " GitHub " } },
			{ id: "docker", label: "Docker build", icon: { slug: "docker" } },
			{ id: "queue", label: "Queue", icon: { slug: "not-a-logo" } },
		],
		messages: [
			{ source: "developer", target: "github", label: "git push" },
			{ source: "github", target: "docker", label: "Build image" },
			{ source: "docker", target: "github", label: "Digest", type: "return" },
			{ source: "github", target: "queue", label: "Enqueue deploy" },
		],
	};

	it("embeds catalog logos in participant headers and exports them as images", async () => {
		const result = await runtime().buildSequenceDiagram({
			spec,
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));

		expect(result.normalizedSpec.participants.map((participant) => participant.icon?.slug)).toEqual(
			[undefined, "github", "docker", undefined],
		);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "unknown_icon",
				severity: "warning",
				ref: { kind: "node", id: "queue", path: "participants.icon.slug" },
				message: expect.stringContaining('participant "queue"'),
			}),
		]);
		const scene = Schema.decodeUnknownSync(RenderedDiagramSceneSchema)(
			result.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		expect(Object.keys(scene.icons ?? {}).sort()).toEqual(["docker", "github"]);
		const headers = scene.elements.filter(
			(element) => element.type === "node" && element.icon !== undefined,
		);
		expect(headers.map((element) => element.type === "node" && element.nodeId)).toEqual([
			"github",
			"docker",
		]);
		const excalidraw = result.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as { elements: { type: string }[]; files?: Record<string, unknown> };
		expect(excalidraw.elements.filter((element) => element.type === "image")).toHaveLength(2);
		expect(Object.keys(excalidraw.files ?? {})).toHaveLength(2);
	});
});
