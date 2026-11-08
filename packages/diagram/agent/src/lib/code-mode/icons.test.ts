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
			catalogIcon("heavy-mark", "Heavy Mark", { bytes: 64 * 1024 + 1 }),
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
function nodeLogos(result: FlowchartBuild): (string | null | undefined)[] {
	if (!result.ok) throw new Error(JSON.stringify(result.issues));
	return Object.values(result.normalizedSpec.nodes).map((node) =>
		typeof node === "string" ? undefined : node.icon,
	);
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
		expect(catalog.get("heavy-mark")).toBeUndefined();
		expect(catalog.search("git", 5).map((icon) => icon.slug)).toEqual(["github"]);
	});
});

describe("buildFlowchart icons", () => {
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

	it("treats prototype-member slugs as unknown", async () => {
		const result = await runtime().buildFlowchart({
			spec: deploySpec({ push: "constructor", build: "__proto__" }),
		});

		expect(nodeLogos(result)).toEqual([undefined, undefined, undefined]);
		expect(result.issues.map((entry) => entry.code)).toEqual(["unknown_icon", "unknown_icon"]);
	});

	it("drops every icon with a warning when the host has no catalog", async () => {
		const result = await runtime(null).buildFlowchart({
			spec: deploySpec({ push: "github" }),
		});

		expect(nodeLogos(result)).toEqual([undefined, undefined, undefined]);
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
		expect(nodeLogos(result)).toEqual(["github", "docker", "docker"]);

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
			nodes: Object.fromEntries(nodes.map(([id, label, icon]) => [id, { label, icon }])),
			edges: nodes.slice(1).map(([id], index) => [nodes[index]?.[0], id]),
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

		expect(nodeLogos(result)).toEqual(["github", "cloudflare", "aws"]);
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

		expect(nodeLogos(result)).toEqual([undefined, "docker", undefined]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				severity: "warning",
				ref: { kind: "node", id: "ingress", path: "nodes.ingress.icon" },
				message: expect.stringContaining('label "Ingress controller" does not name Kubernetes'),
			}),
			expect.objectContaining({
				code: "icon_dropped",
				ref: { kind: "node", id: "s3", path: "nodes.s3.icon" },
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
	const production = () => runtime(productionCatalog);

	// Frontierclimb r20 deploy-pipeline-logos s1: the labels name GitHub, Docker and
	// Cloudflare; logos: true draws each one.
	const r20DeploySpec = {
		title: "Deploy pipeline",
		logos: true,
		nodes: {
			push: "Push to GitHub",
			build: "Docker builds the image",
			tests: "Test suite runs",
			pass: "Tests pass?",
			deploy: "Ship to Cloudflare Workers",
			notify: "Notify the team and stop",
		},
		edges: [
			["push", "build"],
			["build", "tests"],
			["tests", "pass"],
			["pass", "deploy", "Yes"],
			["pass", "notify", "No"],
		],
	};

	function chain(nodes: ReadonlyArray<readonly [string, string, string?]>, logos = true) {
		return {
			title: "Stack",
			...(logos ? { logos: true } : {}),
			nodes: Object.fromEntries(
				nodes.map(([id, label, icon]) => [id, icon ? { label, icon } : label]),
			),
			edges: nodes.slice(1).map(([id], index) => [nodes[index]?.[0], id]),
		};
	}

	it("draws the logo of each product a label names when the document asks for logos", async () => {
		const result = await production().buildFlowchart({ spec: r20DeploySpec });

		expect(nodeLogos(result)).toEqual([
			"github",
			"docker",
			undefined,
			undefined,
			"cloudflare",
			undefined,
		]);
		expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
			["icon_filled", "push"],
			["icon_filled", "build"],
			["icon_filled", "deploy"],
		]);
		expect(result.issues[2]).toEqual({
			code: "icon_filled",
			severity: "info",
			stage: "input",
			ref: { kind: "node", id: "deploy", path: "nodes.deploy.icon" },
			message:
				'Node "deploy" draws the "cloudflare" logo because its label "Ship to Cloudflare Workers" names Cloudflare.',
			hint: "No action needed.",
		});
	});

	it("draws no logo the document does not ask for", async () => {
		const { logos: _logos, ...spec } = r20DeploySpec;
		const result = await production().buildFlowchart({ spec });

		expect(nodeLogos(result).filter(Boolean)).toEqual([]);
		expect(result.issues).toEqual([]);
	});

	it("keeps an icon the document names and drops one set to null", async () => {
		const result = await production().buildFlowchart({
			spec: chain([
				["push", "Push to GitHub", "docker"],
				["ship", "Ship to Cloudflare Workers"],
			]),
		});
		expect(nodeLogos(result)).toEqual(["docker", "cloudflare"]);

		const dropped = await production().buildFlowchart({
			spec: {
				...r20DeploySpec,
				nodes: {
					...r20DeploySpec.nodes,
					deploy: { label: "Ship to Cloudflare Workers", icon: null },
				},
			},
		});
		expect(nodeLogos(dropped)[4]).toBeNull();
	});

	it("draws the first product a label names, and never fills a step word or an unnamed label", async () => {
		const result = await production().buildFlowchart({
			spec: chain([
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
			]),
		});

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
		// "Go", "Stream" and "Notion" start step labels far more often than they name the product.
		expect(
			result.issues.filter((issue) => issue.code === "icon_possible").map((issue) => issue.ref?.id),
		).toEqual(["go", "stream", "notion"]);
		expect(result.issues.find((issue) => issue.ref?.id === "go")).toMatchObject({
			severity: "info",
			message:
				'Node "go" draws no logo: its label "Go to checkout" starts with "Go", which usually names a step, not Go.',
			hint: 'If it means Go, set icon: "Go".',
		});
	});

	it("draws a product that starts a label, and leaves a step word that starts one to an icon", async () => {
		const result = await production().buildFlowchart({
			spec: chain([
				["worker", "Python worker"],
				["app", "Angular app"],
				["fn", "Azure Functions"],
				["pay", "Make payment"],
				["checkout", "Go to checkout"],
				["page", "Render the page"],
			]),
		});
		expect(nodeLogos(result)).toEqual([
			"python",
			"angular",
			"azure",
			undefined,
			undefined,
			undefined,
		]);
		expect(
			result.issues.filter((issue) => issue.code === "icon_possible").map((issue) => issue.ref?.id),
		).toEqual(["pay", "checkout", "page"]);

		const software = await production().buildFlowchart({
			spec: chain([
				["web", "React app"],
				["api", "Spring service"],
				["incident", "React to incident"],
				["edge", "Edge function"],
			]),
		});
		expect(nodeLogos(software)).toEqual(["react", "spring", undefined, undefined]);
		expect(
			software.issues
				.filter((issue) => issue.code === "icon_possible")
				.map((issue) => issue.ref?.id),
		).toEqual(["incident", "edge"]);

		const meant = await production().buildFlowchart({
			spec: chain([
				["pay", "Make payment"],
				["page", "Render the page", "Render"],
			]),
		});
		expect(nodeLogos(meant)).toEqual([undefined, "render"]);
	});

	it("reads dotted product names and names every product a label holds", async () => {
		const result = await production().buildFlowchart({
			spec: chain([
				["worker", "Node.js worker"],
				["app", "Next.js app hosted on Vercel"],
				["cache", "Redis cache on Upstash"],
				["ui", "Vue.js frontend"],
				["socket", "Socket.io server"],
				["db", "Postgres on Supabase"],
			]),
		});

		expect(nodeLogos(result)).toEqual([
			"nodejs",
			"nextjs",
			"redis",
			"vuejs",
			"socketio",
			"postgresql",
		]);
		expect(result.issues.find((issue) => issue.ref?.id === "app")).toMatchObject({
			code: "icon_filled",
			message:
				'Node "app" draws the "nextjs" logo, the first of the products its label "Next.js app hosted on Vercel" names (Next.js, Vercel).',
			hint: 'Set icon to another of them, such as "Vercel", to draw that one instead.',
		});

		const vercel = await production().buildFlowchart({
			spec: chain([
				["app", "Next.js app hosted on Vercel", "Vercel"],
				["worker", "Node.js worker"],
				["ui", "Frontend", "Vue.js"],
			]),
		});
		expect(nodeLogos(vercel)).toEqual(["vercel", "nodejs", "vuejs"]);
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
		// Frontierclimb r23 ai-app-stack-logos s4 (Sonnet): the labels name Next.js,
		// Redis, OpenAI and Sentry, and the group is "Vercel".
		const r23AppSpec = {
			title: "Request flow",
			logos: true,
			nodes: {
				page: "Next.js page receives the question",
				check: "Check Redis cache",
				hit: "Cache hit?",
				call: "Call OpenAI model",
				store: "Store answer in Redis",
				log: "Log any errors to Sentry",
				ret: "Return the answer",
				cached: "Return cached answer",
			},
			edges: [
				["page", "check"],
				["check", "hit"],
				["hit", "cached", "yes"],
				["hit", "call", "no"],
				["call", "store"],
				["store", "log"],
				["log", "ret"],
			],
			groups: {
				vercel: { label: "Vercel", contains: ["page", "check", "hit"] },
			},
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
			groups: Record<string, { label: string; kind?: string; contains: string[] }>,
			nodes: ReadonlyArray<readonly [string, string]>,
		) {
			return { ...chain(nodes), groups };
		}

		it("draws the logo a group's label names before its name, with an info note", async () => {
			const result = await production().buildFlowchart({ spec: r23AppSpec, options });

			expect(groupLogos(result)).toEqual({ vercel: "vercel" });
			expect(result.issues.filter((issue) => issue.ref?.kind === "group")).toEqual([
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
			// The document stays as written: groups take no authored logo.
			expect(result.normalizedSpec.groups).toEqual({
				vercel: { label: "Vercel", contains: ["page", "check", "hit"] },
			});
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
				groups: { vercel: { label: "Vercel", kind: "cloud", contains: ["page", "check", "hit"] } },
			};
			const result = await production().buildFlowchart({ spec, options });

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
			const { logos: _logos, ...withoutLogos } = spec;
			const plain = await production().buildFlowchart({ spec: withoutLogos, options });
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

		it("never fills a group in a diagram that asks for no logos", async () => {
			const { logos: _logos, ...spec } = r23AppSpec;
			const result = await production().buildFlowchart({ spec, options });

			expect(groupLogos(result)).toEqual({});
			expect(result.issues).toEqual([]);
		});

		it("never fills a group whose label names several products or an everyday word", async () => {
			const result = await production().buildFlowchart({
				spec: grouped(
					{
						both: { label: "Vercel and Cloudflare", contains: ["push"] },
						front: { label: "Frontend", contains: ["page"] },
						edge: { label: "Edge", contains: ["route"] },
						stream: { label: "Stream processing", contains: ["events"] },
					},
					[
						["push", "Push to GitHub"],
						["page", "Render the page"],
						["route", "Route the request"],
						["events", "Process events"],
					],
				),
				options,
			});

			expect(groupLogos(result)).toEqual({});
			expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
				["icon_filled", "push"],
				["icon_possible", "page"],
			]);
		});

		it("never repeats a logo a node inside the group, or a group around it, already draws", async () => {
			const result = await production().buildFlowchart({
				spec: grouped(
					{
						cf: { label: "Cloudflare", kind: "cloud", contains: ["worker"] },
						aws: { label: "AWS", kind: "cloud", contains: ["region"] },
						region: { label: "AWS us-east-1", kind: "region", contains: ["queue"] },
					},
					[
						["push", "Push to GitHub"],
						["worker", "Cloudflare Workers"],
						["queue", "Enqueue the job"],
					],
				),
				options,
			});

			expect(groupLogos(result)).toEqual({ aws: "aws" });
			expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
				["icon_filled", "push"],
				["icon_filled", "worker"],
				["icon_filled", "aws"],
			]);
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

	it("drops an icon whose SVG cannot be normalized", async () => {
		const catalog: CodeModeIconCatalog = {
			...fixtureCatalog(),
			loadSvg: () => Effect.succeed("<not-an-svg />"),
		};
		const result = await runtime(catalog).createCanvas({
			spec: canvasSpec([{ id: "malformed", icon: { slug: "docker", size: 28 } }]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "icon_dropped",
				ref: { kind: "element", id: "malformed", path: "elements[0].icon.slug" },
			}),
		]);
		expect(inlineScene(result).icons).toBeUndefined();
	});

	it("does not hide an icon loader defect or interruption as a dropped icon", async () => {
		for (const loadSvg of [
			() => Effect.die(new Error("loader bug")),
			() => Effect.interrupt,
		] satisfies ReadonlyArray<CodeModeIconCatalog["loadSvg"]>) {
			const catalog: CodeModeIconCatalog = { ...fixtureCatalog(), loadSvg };
			await expect(
				runtime(catalog).createCanvas({
					spec: canvasSpec([{ id: "logo", icon: { slug: "docker", size: 28 } }]),
					options: { inlineArtifacts: ["scene"] },
				}),
			).rejects.toBeDefined();
		}
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

describe("hand-drawn icons", () => {
	const RECIPE = {
		parts: [{ kind: "rect", x: 2, y: 6, width: 20, height: 12, rounded: true, fill: "#2496ed" }],
	} as const;

	function recipeCatalog(loaded: string[]): CodeModeIconCatalog {
		const base = fixtureCatalog();
		const catalog = makeCodeModeIconCatalog({
			icons: [catalogIcon("docker", "Docker"), catalogIcon("github", "GitHub")],
			loadSvg: (icon) => {
				loaded.push(icon.slug);
				return base.loadSvg(icon);
			},
			recipes: { docker: RECIPE, github: { parts: [] }, "made-up": RECIPE },
			slugLookup: "sketchi.searchIcons({ q })",
		});
		return catalog;
	}

	it("keeps only drawable recipes for catalog marks", () => {
		const catalog = recipeCatalog([]);
		expect(catalog.recipe("docker")).toEqual(RECIPE);
		expect(catalog.recipe("github")).toBeUndefined();
		expect(catalog.recipe("made-up")).toBeUndefined();
	});

	it("embeds the recipe and never reads the SVG of a mark drawn by hand", async () => {
		const loaded: string[] = [];
		const result = await runtime(recipeCatalog(loaded)).createCanvas({
			spec: canvasSpec([
				{ id: "build", icon: { slug: "docker", size: 28 } },
				{ id: "push", icon: { slug: "github", size: 28 } },
			]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.issues).toEqual([]);
		expect(loaded).toEqual(["github"]);
		expect(inlineScene(result).icons).toEqual({
			docker: { name: "Docker", recipe: RECIPE },
			github: {
				name: "GitHub",
				svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle r="1"/></svg>',
			},
		});
	});

	it("embeds the exact SVG for an icon that asks for it", async () => {
		const loaded: string[] = [];
		const result = await runtime(recipeCatalog(loaded)).createCanvas({
			spec: canvasSpec([
				{ id: "exact", icon: { slug: "docker", size: 28, exact: true } },
				{ id: "drawn", icon: { slug: "docker", size: 28 } },
			]),
			options: { inlineArtifacts: ["scene"] },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(loaded).toEqual(["docker"]);
		const scene = inlineScene(result);
		expect(scene.icons?.["docker"]).toEqual({
			name: "Docker",
			recipe: RECIPE,
			svg: '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>',
		});
		expect(
			scene.elements.map((element) => (element.type === "node" ? element.icon : undefined)),
		).toEqual([
			{ slug: "docker", size: 28, exact: true },
			{ slug: "docker", size: 28 },
		]);
	});
	it("embeds catalog SVG marks for a flowchart whose document asks for exact logos", async () => {
		const spec = {
			title: "Build",
			nodes: { build: "Build with Docker", ship: "Ship it" },
			edges: [["build", "ship"]],
		};
		const options = { artifactFormats: ["scene"], inlineArtifacts: ["scene"] };
		const drawnLoads: string[] = [];
		const drawn = await runtime(recipeCatalog(drawnLoads)).buildFlowchart({
			spec: { ...spec, logos: true },
			options,
		});
		if (!drawn.ok) throw new Error(JSON.stringify(drawn.issues));
		expect(drawnLoads).toEqual([]);
		expect(inlineScene(drawn).icons?.["docker"]).toEqual({ name: "Docker", recipe: RECIPE });

		const exactLoads: string[] = [];
		const exact = await runtime(recipeCatalog(exactLoads)).buildFlowchart({
			spec: { ...spec, logos: "exact" },
			options,
		});
		if (!exact.ok) throw new Error(JSON.stringify(exact.issues));
		expect(exactLoads).toEqual(["docker"]);
		expect(inlineScene(exact).icons?.["docker"]).toMatchObject({
			svg: expect.stringContaining("<svg"),
		});
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
