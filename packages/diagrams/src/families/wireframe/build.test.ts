import { buildResponse, type BuildRejection } from "../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { type CanvasSpec as RenderedDiagramScene } from "@sketchi/drawing";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../build/code-mode/artifacts.js";
import {
	applyDiagramPatch,
	buildWireframe,
	CodeModeRuntimeEnvironment,
} from "../../build/code-mode/runtime.js";

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
function build(spec: unknown) {
	return run(
		buildWireframe({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
}
const inline = (built: { artifact: { formats: { format: string; inline?: unknown }[] } }) =>
	new Map(built.artifact.formats.map((format) => [format.format, format.inline]));

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

describe("Code Mode native wireframe", () => {
	it("builds the documented spec into a framed screen of grouped components", async () => {
		const built = await build(loginSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens[0]?.device).toBe("mobile");
		expect(built.normalizedSpec).toMatchObject({
			id: "login",
			title: "Login",
			screens: [{ id: "login", name: "Login", device: "mobile" }],
		});
		expect(built.normalizedSpec.screens[0]!.children).toEqual(loginSpec.screens[0]!.children);
		const scene = inline(built).get("scene") as RenderedDiagramScene;
		expect(scene.elements.filter((element) => element.type === "frame")).toMatchObject([
			{ id: "frame:login", name: "Login", width: 390 },
		]);
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it("reads the ways models write a wireframe", async () => {
		const built = await build({
			id: "shop",
			title: "Shop",
			type: "wireframe",
			pages: [
				{
					title: "Product page",
					platform: "iPhone",
					components: [
						{ type: "navbar", items: [{ label: "Home" }, { label: "Shop", active: true }] },
						{ type: "H2", label: "Trail runner" },
						{ type: "paragraph" },
						{ type: "dropdown", label: "Size", options: ["S", "M"], value: "M" },
						{ type: "text-input", label: "Quantity", value: 1 },
						{ type: "button", label: "Add to cart", primary: true },
						{ type: "CTA", text: "Buy now" },
						{ type: "switch", text: "Gift wrap", on: true },
						{ type: "search-bar", text: "Search shoes" },
						{ type: "img", alt: "Shoe photo" },
						{ type: "bar-chart", title: "Sales" },
						{ type: "data-table", headers: [{ title: "Order" }, "Total"], data: [[1], [2]] },
						{
							type: "dialog",
							label: "Confirm",
							elements: [{ component: "button", label: "OK", style: "outline" }],
						},
						{ type: "hstack", justify: "space-between", children: [{ type: "tag", label: "New" }] },
					],
				},
				{ name: "Product page", children: [{ type: "hr" }] },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec).toMatchObject({
			id: "shop",
			title: "Shop",
			type: "wireframe",
			screens: [
				{
					id: "product-page",
					name: "Product page",
					device: "mobile",
					children: [
						{ type: "nav", items: ["Home", "Shop"], active: "Shop" },
						{ type: "heading", level: 2, text: "Trail runner" },
						{ type: "text" },
						{ type: "select", label: "Size", value: "M" },
						{ type: "input", label: "Quantity", value: "1" },
						{ type: "button", text: "Add to cart", variant: "primary" },
						{ type: "button", variant: "primary", text: "Buy now" },
						{ type: "toggle", label: "Gift wrap", checked: true },
						{ type: "search", placeholder: "Search shoes" },
						{ type: "image", label: "Shoe photo" },
						{ type: "chart", kind: "bar", label: "Sales" },
						{ type: "table", columns: ["Order", "Total"], rows: 2 },
						{
							type: "modal",
							title: "Confirm",
							children: [{ type: "button", text: "OK", variant: "secondary" }],
						},
						{ type: "row", align: "between", children: [{ type: "badge", text: "New" }] },
					],
				},
				{ id: "product-page-2", name: "Product page", children: [{ type: "divider" }] },
			],
		});
	});

	it("names omitted screen ids by their names, clear of explicit ones", async () => {
		const screen = (name: string, id?: string) => ({
			...(id ? { id } : {}),
			name,
			children: [{ type: "heading", text: name }],
		});
		const built = await build({
			title: "Flow",
			screens: [
				screen("Sign up"),
				screen("Sign up"),
				screen("Verify", "sign-up-2"),
				screen("!!"),
				screen("東京".repeat(30)),
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens.map((entry) => entry.id)).toEqual([
			"sign-up",
			"sign-up-3",
			"sign-up-2",
			"screen-4",
			"東京".repeat(30),
		]);
		const collision = await build({
			title: "Unicode navigation",
			screens: [
				{ name: "𝐀", children: [{ type: "heading", text: "Destination" }] },
				{
					id: "a",
					name: "Origin",
					children: [{ type: "button", text: "Open", target: "A" }],
				},
			],
		});
		if (!collision.ok) throw new Error(JSON.stringify(collision.issues));
		expect(collision.normalizedSpec.screens.map((entry) => entry.id)).toEqual(["A", "a"]);
		expect(collision.normalizedSpec.screens[1]?.children[0]?.target).toBe("A");
		const native = inline(collision).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(native)).toEqual({ ok: true, issues: [] });
		expect(native.elements.find((entry) => entry.id === "nav:a:0")).toMatchObject({
			type: "arrow",
			endBinding: { elementId: "frame:A" },
		});
		expect(
			await Effect.runPromise(storage.read(collision.artifact.artifactId, "excalidraw")),
		).toMatchObject({ data: native });
		expect(
			await Effect.runPromise(storage.read(collision.artifact.artifactId, "scene")),
		).toMatchObject({ data: inline(collision).get("scene") });
	});

	it("keeps a component's group and role through a patch", async () => {
		const built = await build(loginSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
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
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as RenderedDiagramScene;
		expect(scene.elements.find((element) => element.id === "wf:login:4:box")).toMatchObject({
			fillColor: "#2f9e44",
			rendererRole: "wireframe-widget",
			groupIds: ["group:login:4"],
		});
		const excalidraw = inline(patched).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it.each([
		[[{ type: "button" }], "missing_wireframe_text"],
		[[{ type: "tabs", items: ["A"], active: "B" }], "invalid_wireframe_option"],
		[[{ type: "button", text: "Go", level: 2 }], "invalid_wireframe_option"],
		[[{ type: "row", children: [] }], "empty_wireframe_container"],
		[[{ type: "button", text: "x".repeat(61) }], "wireframe_text_too_long"],
		[Array.from({ length: 161 }, () => ({ type: "divider" })), "wireframe_too_large"],
	])("rejects %j with a structured repair issue", async (children, code) => {
		const result = await build({ title: "Bad", screens: [{ name: "Bad", children }] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_wireframe");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});

	it("rejects repeated screen ids and a screen id with a colon", async () => {
		const screen = (id: string) => ({ id, name: id, children: [{ type: "divider" }] });
		const repeated = await build({ title: "Bad", screens: [screen("a"), screen("a")] });
		expect(repeated.issues.map((issue) => issue.code)).toEqual(["duplicate_screen_id"]);
		const colon = await build({ title: "Bad", screens: [screen("a:b")] });
		expect(colon.issues.map((issue) => issue.code)).toEqual(["invalid_screen_id"]);
	});

	it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
		"rejects the inherited name %s as a type or device as invalid input, never crashing",
		async (name) => {
			const typed = await build({
				title: "Bad",
				screens: [{ name: "Bad", children: [{ type: name }] }],
			});
			expect(typed).toMatchObject({ ok: false, status: "invalid_input" });
			const device = await build({
				title: "Bad",
				screens: [{ name: "Bad", device: name, children: [{ type: "divider" }] }],
			});
			expect(device).toMatchObject({ ok: false, status: "invalid_input" });
		},
	);

	it("draws a zero written as a number, and rejects a null list instead of dropping it", async () => {
		for (const component of [
			{ type: "text", lines: 0 },
			{ type: "table", columns: ["A"], rows: 0 },
			{ type: "heading", text: "Hi", level: 0 },
			{ type: "grid", columns: 0, children: [{ type: "divider" }] },
		]) {
			const refused = await build({
				title: "Zero",
				screens: [{ name: "Home", children: [component] }],
			});
			expect(refused).toMatchObject({
				ok: false,
				status: "invalid_wireframe",
				issues: [expect.objectContaining({ code: "invalid_wireframe_option" })],
			});
		}

		const built = await build({
			title: "Seats",
			screens: [
				{
					name: "Seats",
					children: [
						{ type: "heading", text: 0 },
						{ type: "input", label: "Seats", value: 0 },
						{ type: "tabs", items: [0, 1], active: 0 },
					],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens[0]!.children).toEqual([
			{ type: "heading", text: "0" },
			{ type: "input", label: "Seats", value: "0" },
			{ type: "tabs", items: ["0", "1"], active: "0" },
		]);
		const nulled = await build({
			title: "Bad",
			screens: [{ name: "Bad", children: [{ type: "card", children: null }] }],
		});
		expect(nulled).toMatchObject({ ok: false, status: "invalid_input" });
		expect(nulled.issues[0]?.ref?.path).toContain("children");
	});

	it("draws a control's target as an arrow to the screen it opens, by id or by name", async () => {
		const built = await build({
			title: "Signup",
			screens: [
				{
					name: "Sign up",
					device: "mobile",
					children: [
						{ type: "button", text: "Continue", variant: "primary", goTo: "Verify email" },
					],
				},
				{
					name: "Verify email",
					device: "mobile",
					children: [{ type: "link", text: "Back", target: "sign-up" }],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens.map((screen) => screen.children[0]!.target)).toEqual([
			"verify-email",
			"sign-up",
		]);
		const scene = inline(built).get("scene") as RenderedDiagramScene;
		expect(
			scene.elements.filter((element) => element.type === "arrow").map((arrow) => arrow.id),
		).toEqual(["nav:sign-up:0", "nav:verify-email:0"]);
		const excalidraw = inline(built).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const unknown = await build({
			title: "Bad",
			screens: [{ name: "Home", children: [{ type: "button", text: "Go", target: "nowhere" }] }],
		});
		expect(unknown).toMatchObject({ ok: false, status: "invalid_wireframe" });
		expect(unknown.issues.map((issue) => issue.code)).toEqual(["unknown_wireframe_target"]);
		// Ids that squash alike stay apart: a target naming one exactly opens that one.
		const alike = await build({
			title: "Alike",
			screens: [
				{ id: "sign-up", name: "Sign up", children: [{ type: "heading", text: "Sign up" }] },
				{
					id: "signup",
					name: "Signup",
					children: [{ type: "button", text: "Back", target: "sign-up" }],
				},
			],
		});
		if (!alike.ok) throw new Error(JSON.stringify(alike.issues));
		expect(alike.normalizedSpec.screens[1]!.children[0]!.target).toBe("sign-up");
	});

	it("rejects an unknown component type before building, naming the field", async () => {
		const result = await build({
			title: "Bad",
			screens: [{ name: "Bad", children: [{ type: "carousel" }] }],
		});
		expect(result).toMatchObject({ ok: false, status: "invalid_input" });
		expect(result.issues[0]?.ref?.path).toContain("type");
	});
});

it("keeps repeated tab and nav state unique through the actual native build", async () => {
	for (const type of ["tabs", "nav"]) {
		const result = await build({
			title: "Repeated",
			screens: [
				{ name: "Screen", children: [{ type, items: ["Orders", "Orders"], active: "Orders" }] },
			],
		});
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		const scene = inline(result).get("scene") as RenderedDiagramScene;
		const ids = scene.elements.map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.filter((id) => id.endsWith(":active"))).toEqual(["wf:screen:0:active"]);
		const native = inline(result).get("excalidraw") as Parameters<
			typeof validateExcalidrawScene
		>[0];
		expect(validateExcalidrawScene(native)).toEqual({ ok: true, issues: [] });
		expect(result.normalizedSpec.screens[0]?.device).toBe("desktop");
	}
});

it("refuses deep unknown trees before shorthand decoding or exporting, including cyclic objects", async () => {
	let child: Record<string, unknown> = { type: "button", text: "Go" };
	for (let i = 0; i < 10000; i++) child = { type: "column", children: [child] };
	const cycle: Record<string, unknown> = { type: "column" };
	cycle.children = [cycle];
	for (const component of [child, cycle]) {
		const result = await build({
			title: "Deep",
			pages: [{ name: "Screen", components: [component] }],
		});
		expect(result).toMatchObject({ ok: false, status: "invalid_wireframe" });
		expect(result.issues[0]).toMatchObject({
			code: "wireframe_too_large",
			ref: { path: expect.stringContaining("spec.") },
		});
		expect("artifact" in result).toBe(false);
	}
});

it("retains depth and element capacity limits at the public input boundary", async () => {
	const nested = (depth: number): unknown =>
		depth === 1
			? { type: "button", text: "Go" }
			: { type: "column", children: [nested(depth - 1)] };
	const spec = (children: unknown[]) => ({
		title: "Capacity",
		screens: [{ name: "Screen", children }],
	});
	expect((await build(spec([nested(8)]))).ok).toBe(true);
	expect(await build(spec([nested(9)]))).toMatchObject({
		ok: false,
		status: "invalid_wireframe",
		issues: [expect.objectContaining({ code: "wireframe_too_large" })],
	});
	const table = {
		type: "table",
		columns: Array.from({ length: 8 }, (_, i) => `Column ${i}`),
		rows: 8,
	};
	expect((await build(spec([table, table, table]))).ok).toBe(true);
	expect(await build(spec([table, table, table, table]))).toMatchObject({
		ok: false,
		status: "invalid_wireframe",
		issues: [expect.objectContaining({ code: "wireframe_too_large" })],
	});
});

it.each([null, 42, "bad", { type: "text", text: "lost" }])(
	"refuses malformed aliased collections instead of losing them: %j",
	async (malformed) => {
		for (const spec of [
			{ title: "Bad", pages: malformed },
			{ title: "Bad", pages: [{ name: "Home", components: malformed }] },
			{
				title: "Bad",
				pages: [{ name: "Home", components: [{ type: "row", components: malformed }] }],
			},
			{
				title: "Bad",
				pages: [{ name: "Home", components: [{ type: "tabs", options: malformed }] }],
			},
		])
			expect(await build(spec)).toMatchObject({ ok: false, status: "invalid_input" });
	},
);
