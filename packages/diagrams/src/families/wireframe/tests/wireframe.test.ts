import { type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../../build/code-mode/artifacts.js";
import { buildWireframe } from "../../../build/code-mode/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/code-mode/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import {
	getWireframeValidationIssues,
	parseWireframeDiagram,
	WIREFRAME_MAX_COMPONENTS,
	WIREFRAME_MAX_ELEMENTS,
	WIREFRAME_MAX_SCREENS,
	type WireframeDiagram,
	wireframeFixture,
	WireframeValidationIssueCodeSchema,
} from "../document.js";
import {
	type WireframeBoxIssue,
	wireframeBoxIssues,
	type WireframeLayoutIssue,
	wireframeLayoutIssues,
} from "../readout.js";
import { renderWireframeDiagram } from "../render.js";

const storage = makeMemoryArtifactStorage();
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
} as const;
const build = (spec: unknown) => run(buildWireframe({ spec, options }));
const inline = (built: { artifact: { formats: { format: string; inline?: unknown }[] } }) =>
	new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
type Excalidraw = Parameters<typeof validateExcalidrawScene>[0];

/** The documented example: a phone login screen. */
const loginSpec = {
	title: "Login",
	screens: [
		{
			name: "Login",
			device: "mobile",
			children: [
				{ type: "heading", text: "Welcome back" },
				{ type: "input", label: "Email", placeholder: "you@example.com" },
				{ type: "input", label: "Password" },
				{ type: "checkbox", label: "Remember me", checked: true },
				{ type: "button", text: "Sign in", variant: "primary" },
				{ type: "link", text: "Forgot password?" },
			],
		},
	],
};

describe("wireframes", () => {
	it("build the documented spec into a valid Excalidraw file that keeps groups and roles through a patch", async () => {
		const built = await build(loginSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(validateExcalidrawScene(inline(built).get("excalidraw") as Excalidraw)).toEqual({
			ok: true,
			issues: [],
		});

		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["wf:login:4:box"] },
						style: { fillColor: "#2f9e44" },
					},
				],
				options,
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as CanvasSpec;
		expect(scene.elements.find((element) => element.id === "wf:login:4:box")).toMatchObject({
			fillColor: "#2f9e44",
			rendererRole: "wireframe-widget",
			groupIds: ["group:login:4"],
		});
		expect(validateExcalidrawScene(inline(patched).get("excalidraw") as Excalidraw)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("refuse deep and cyclic component trees before decoding or exporting them", async () => {
		let deep: Record<string, unknown> = { type: "button", text: "Go" };
		for (let i = 0; i < 10_000; i++) deep = { type: "column", children: [deep] };
		const cycle: Record<string, unknown> = { type: "column" };
		cycle["children"] = [cycle];
		for (const component of [deep, cycle]) {
			const result = await build({
				title: "Deep",
				pages: [{ name: "Screen", components: [component] }],
			});
			expect(result).toMatchObject({ ok: false, status: "invalid_wireframe" });
			expect(result.issues[0]?.code).toBe("wireframe_too_large");
			expect("artifact" in result).toBe(false);
		}
	});

	it("place the largest allowed tree deterministically with bounded component reads", () => {
		const diagram = parseWireframeDiagram({
			id: "capacity",
			type: "wireframe",
			title: "Capacity",
			screens: Array.from({ length: WIREFRAME_MAX_SCREENS }, (_, screen) => ({
				id: `s${screen}`,
				name: `Screen ${screen}`,
				device: "desktop",
				children: Array.from({ length: screen === 0 ? 30 : 26 }, (_, i) => ({
					type: "heading",
					text: `Heading ${i}`,
				})),
			})),
		}).pipe(Result.getOrThrow);
		let reads = 0;
		const counted = {
			...diagram,
			screens: diagram.screens.map((screen) => ({
				...screen,
				children: new Proxy(screen.children, {
					get(target, key, receiver) {
						if (typeof key === "string" && /^\d+$/.test(key)) reads++;
						return Reflect.get(target, key, receiver);
					},
				}),
			})),
		};
		const { scene, layout } = renderWireframeDiagram(counted);
		expect(layout.screens.reduce((sum, screen) => sum + screen.components.length, 0)).toBe(
			WIREFRAME_MAX_COMPONENTS,
		);
		expect(reads).toBeLessThanOrEqual(WIREFRAME_MAX_COMPONENTS * 8);
		expect(renderWireframeDiagram(counted).scene).toEqual(scene);
		expect(scene.elements.length).toBeLessThanOrEqual(WIREFRAME_MAX_ELEMENTS);
		expect(wireframeBoxIssues(layout)).toEqual([]);
		expect(wireframeLayoutIssues(scene)).toEqual([]);
	});
});

const screen = (id: string, children: unknown[] = [{ type: "divider" }]) => ({
	id,
	name: id,
	device: "mobile",
	children,
});

/** One minimal bad wireframe per code the validator owns. */
const bad: Record<string, unknown[]> = {
	wireframe_too_large: [
		screen(
			"a",
			Array.from({ length: WIREFRAME_MAX_COMPONENTS + 1 }, () => ({ type: "divider" })),
		),
	],
	invalid_screen_id: [screen("a:b")],
	duplicate_screen_id: [screen("a"), screen("a")],
	empty_wireframe_screen: [screen("a", [])],
	unknown_wireframe_target: [screen("a", [{ type: "button", text: "Go", target: "nowhere" }])],
	empty_wireframe_container: [screen("a", [{ type: "row", children: [] }])],
	missing_wireframe_text: [screen("a", [{ type: "button" }])],
	wireframe_text_too_long: [screen("a", [{ type: "button", text: "x".repeat(61) }])],
	invalid_wireframe_option: [screen("a", [{ type: "tabs", items: ["A"], active: "B" }])],
};

describe("wireframe validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(WireframeValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad wireframe", (code, screens) => {
		const issues = getWireframeValidationIssues({
			...wireframeFixture,
			screens,
		} as WireframeDiagram);
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});

/** Two phone screens: a heading, a button that opens the second, and a row of two buttons. */
const navigation = parseWireframeDiagram({
	id: "nav",
	title: "Nav",
	type: "wireframe",
	screens: [
		{
			id: "a",
			name: "A",
			device: "mobile",
			children: [
				{ type: "heading", text: "Hello" },
				{ type: "button", text: "Next", target: "b" },
				{
					type: "row",
					children: [
						{ type: "button", text: "One" },
						{ type: "button", text: "Two" },
					],
				},
			],
		},
		{ id: "b", name: "B", device: "mobile", children: [{ type: "heading", text: "Bye" }] },
	],
}).pipe(Result.getOrThrow);

type Loose = Record<string, unknown> & { x: number; y: number };
const at = (scene: CanvasSpec, id: string) => {
	const element = scene.elements.find((candidate) => candidate.id === id);
	if (!element) throw new Error(`No element ${id}.`);
	return element as unknown as Loose;
};

/** One deliberately broken drawing per issue the fuzz oracle reads from the scene. */
const brokenScene: Record<WireframeLayoutIssue["code"], (scene: CanvasSpec) => void> = {
	"frames-overlap": (scene) => {
		at(scene, "frame:b").x = 40;
	},
	"outside-frame": (scene) => {
		at(scene, "wf:a:1:box").x = -500;
	},
	"shapes-overlap": (scene) => {
		at(scene, "wf:a:2.1:box").x = 100;
	},
	"text-crosses-shape": (scene) => {
		Object.assign(at(scene, "wf:a:0:text"), { x: 136, y: 149 });
	},
	"texts-overlap": (scene) => {
		Object.assign(at(scene, "wf:a:0:text"), { x: 96, y: 209 });
	},
	"text-outside-component": (scene) => {
		at(scene, "wf:a:1:label").fontSize = 80;
	},
	"arrow-crosses": (scene) => {
		at(scene, "nav:a:1").points = [
			{ x: 0, y: 209 },
			{ x: 1000, y: 209 },
		];
	},
};

type Layout = ReturnType<typeof renderWireframeDiagram>["layout"];
type LooseBox = { x: number; y: number; width: number; height: number };
const component = (layout: Layout, path: string) =>
	layout.screens[0]!.components.find((entry) => entry.path === path) as unknown as {
		box: LooseBox;
		flow?: { gap: number };
	};

/** One deliberately broken placement per issue the fuzz oracle reads from the layout. */
const brokenLayout: Record<WireframeBoxIssue["code"], (layout: Layout) => void> = {
	"outside-screen": (layout) => {
		component(layout, "1").box.x = -500;
	},
	"outside-parent": (layout) => {
		component(layout, "2.0").box.y = 400;
	},
	"siblings-overlap": (layout) => {
		component(layout, "2.1").box.x = 100;
	},
	"gap-off-scale": (layout) => {
		component(layout, "2").flow!.gap = 13;
	},
	"uneven-gap": (layout) => {
		component(layout, "2.1").box.x = 160;
	},
	"small-touch-target": (layout) => {
		component(layout, "1").box.height = 30;
	},
	"screen-widened": (layout) => {
		(layout.screens[0] as { widened?: boolean }).widened = true;
	},
};

describe("wireframe layout readout", () => {
	it("reads the clean drawing as clean", () => {
		const { scene, layout } = renderWireframeDiagram(navigation);
		expect(wireframeLayoutIssues(scene)).toEqual([]);
		expect(wireframeBoxIssues(layout)).toEqual([]);
	});

	it.each(Object.entries(brokenScene))(
		"reports %s on a drawing broken that way",
		(code, breakIt) => {
			const scene = structuredClone(renderWireframeDiagram(navigation).scene);
			breakIt(scene);
			expect(wireframeLayoutIssues(scene).map((issue) => issue.code)).toContain(code);
		},
	);

	it.each(Object.entries(brokenLayout))(
		"reports %s on a placement broken that way",
		(code, breakIt) => {
			const layout = structuredClone(renderWireframeDiagram(navigation).layout);
			breakIt(layout);
			expect(wireframeBoxIssues(layout).map((issue) => issue.code)).toContain(code);
		},
	);
});
