import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { wireframeFixture, wireframeStressFixtures } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildWireframeResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildWireframe, CodeModeRuntimeEnvironment } from "./runtime.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		effect.pipe(
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
		expect(() => Schema.decodeUnknownSync(BuildWireframeResultSchema)(built)).not.toThrow();
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
			title: "Shop",
			pages: [
				{
					title: "Product",
					platform: "web",
					components: [
						{ type: "navbar", items: [{ label: "Men" }, { label: "Sale", active: true }] },
						{ type: "img", alt: "Backpack" },
						{ type: "dropdown", label: "Color", options: ["Slate", "Moss"], value: "Slate" },
						{ type: "button", label: "Add to cart", primary: true },
						{ type: "switch", label: "Gift wrap", on: true },
						{ type: "dialog", label: "Added", content: [{ type: "paragraph" }] },
					],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens).toEqual([
			{
				id: "product",
				name: "Product",
				device: "desktop",
				children: [
					{ type: "nav", items: ["Men", "Sale"], active: "Sale" },
					{ type: "image", label: "Backpack" },
					{ type: "select", label: "Color", value: "Slate" },
					{ type: "button", text: "Add to cart", variant: "primary" },
					{ type: "toggle", label: "Gift wrap", checked: true },
					{ type: "modal", title: "Added", children: [{ type: "text" }] },
				],
			},
		]);
	});

	it("names omitted screen ids by their names, clear of explicit ones", async () => {
		const screen = (name: string, id?: string) => ({
			...(id ? { id } : {}),
			name,
			children: [{ type: "heading", text: name }],
		});
		const built = await build({
			title: "Flow",
			screens: [screen("Sign up"), screen("Sign up"), screen("Verify", "sign-up-2"), screen("!!")],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens.map((entry) => entry.id)).toEqual([
			"sign-up",
			"sign-up-3",
			"sign-up-2",
			"screen-4",
		]);
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

	it("round-trips canonical diagrams through their Code Mode documents", async () => {
		for (const diagram of [wireframeFixture, ...Object.values(wireframeStressFixtures)]) {
			const document = canonicalDocumentFromDiagram(diagram);
			expect(document.type).toBe("wireframe");
			const built = await build(document.spec);
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.screens).toEqual(diagram.screens);
		}
	});

	it.each([
		[[{ type: "button" }], "invalid_component"],
		[[{ type: "tabs", items: ["A"], active: "B" }], "invalid_component"],
		[[{ type: "button", text: "Go", level: 2 }], "invalid_component"],
		[[{ type: "row", children: [] }], "invalid_component"],
		[[{ type: "button", text: "x".repeat(61) }], "label_too_long"],
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
		expect(repeated.issues.map((issue) => issue.code)).toEqual(["duplicate_node_id"]);
		const colon = await build({ title: "Bad", screens: [screen("a:b")] });
		expect(colon.issues.map((issue) => issue.code)).toEqual(["invalid_screen"]);
	});

	it.each(["constructor", "__proto__"])(
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
		const built = await build({
			title: "Seats",
			screens: [
				{
					name: "Seats",
					children: [
						{ type: "heading", text: 0 },
						{ type: "input", label: "Seats", value: 0 },
					],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.screens[0]!.children).toEqual([
			{ type: "heading", text: "0" },
			{ type: "input", label: "Seats", value: "0" },
		]);
		const nulled = await build({
			title: "Bad",
			screens: [{ name: "Bad", children: [{ type: "card", children: null }] }],
		});
		expect(nulled).toMatchObject({ ok: false, status: "invalid_input" });
		expect(nulled.issues[0]?.ref?.path).toContain("children");
	});

	it("builds tabs that repeat an item, marking the first active", async () => {
		const built = await build({
			title: "Orders",
			screens: [
				{
					name: "Orders",
					children: [{ type: "tabs", items: ["Orders", "Orders"], active: "Orders" }],
				},
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.status).toBe("accepted");
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
		expect(unknown.issues.map((issue) => issue.code)).toEqual(["missing_edge_target"]);
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
