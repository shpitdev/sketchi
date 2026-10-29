import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { wireframeStressFixtures } from "../wireframe-fixtures";
import {
	getWireframeValidationIssues,
	parseWireframeDiagram,
	resolveWireframeShorthand,
	WIREFRAME_MAX_COMPONENTS,
	WIREFRAME_MAX_DEPTH,
	WIREFRAME_MAX_SCREENS,
	wireframeComponents,
	wireframeDiagramType,
	wireframeFixture,
	WireframeValidationError,
} from "./wireframe";

const wireframe = (children: unknown[], screen: Record<string, unknown> = {}) => ({
	id: "app",
	title: "App",
	type: wireframeDiagramType,
	screens: [{ id: "home", name: "Home", children, ...screen }],
});

/** The issues a wireframe fails with, or [] when it is valid. */
function issuesOf(input: unknown) {
	try {
		parseWireframeDiagram(input);
		return [];
	} catch (error) {
		if (!(error instanceof WireframeValidationError)) throw error;
		return error.issues;
	}
}
const codes = (input: unknown) => issuesOf(input).map((issue) => issue.code);

describe("wireframe contract", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(wireframeFixture.type).toBe(wireframeDiagramType);
		expect(parseCanonicalDiagram(wireframeFixture)).toEqual(wireframeFixture);
		expect(wireframeFixture.screens[0]?.device).toBe("mobile");
		for (const fixture of Object.values(wireframeStressFixtures))
			expect(getWireframeValidationIssues(fixture), fixture.id).toEqual([]);
	});

	it("defaults the device to desktop and the palette", () => {
		const parsed = parseWireframeDiagram(wireframe([{ type: "heading", text: "Hi" }]));
		expect(parsed.screens[0]?.device).toBe("desktop");
		expect(parsed.style).toMatchObject({ accentColor: expect.any(String) });
	});

	it("walks every component with its path and depth", () => {
		const parsed = parseWireframeDiagram(
			wireframe([
				{ type: "header", children: [{ type: "heading", text: "Acme" }] },
				{ type: "card", children: [{ type: "row", children: [{ type: "button", text: "Go" }] }] },
			]),
		);
		expect(
			[...wireframeComponents(parsed)].map(({ component, path, depth }) => [
				component.type,
				path,
				depth,
			]),
		).toEqual([
			["header", "screens.[0].children.[0]", 1],
			["heading", "screens.[0].children.[0].children.[0]", 2],
			["card", "screens.[0].children.[1]", 1],
			["row", "screens.[0].children.[1].children.[0]", 2],
			["button", "screens.[0].children.[1].children.[0].children.[0]", 3],
		]);
	});

	it.each([
		["a button without text", [{ type: "button" }], "missing_wireframe_text"],
		["a checkbox without a label", [{ type: "checkbox" }], "missing_wireframe_text"],
		["tabs without items", [{ type: "tabs", items: [] }], "missing_wireframe_text"],
		["a table without columns", [{ type: "table" }], "missing_wireframe_text"],
		[
			"a grid without a column count",
			[{ type: "grid", children: [{ type: "card" }] }],
			"invalid_wireframe_option",
		],
		[
			"a grid of nine columns",
			[{ type: "grid", columns: 9, children: [{ type: "card" }] }],
			"invalid_wireframe_option",
		],
		[
			"a heading of level 5",
			[{ type: "heading", text: "Hi", level: 5 }],
			"invalid_wireframe_option",
		],
		[
			"children on a widget",
			[{ type: "button", text: "Go", children: [] }],
			"invalid_wireframe_option",
		],
		["a level on a button", [{ type: "button", text: "Go", level: 2 }], "invalid_wireframe_option"],
		[
			"an active tab that is not an item",
			[{ type: "tabs", items: ["A", "B"], active: "C" }],
			"invalid_wireframe_option",
		],
		[
			"align between in a column",
			[{ type: "column", align: "between", children: [{ type: "divider" }] }],
			"invalid_wireframe_option",
		],
		["an empty row", [{ type: "row", children: [] }], "empty_wireframe_container"],
		["a long button", [{ type: "button", text: "x".repeat(61) }], "wireframe_text_too_long"],
		[
			"thirteen nav items",
			[{ type: "nav", items: Array.from({ length: 13 }, (_, i) => `Item ${i}`) }],
			"wireframe_too_large",
		],
		["nine table rows", [{ type: "table", columns: ["A"], rows: 9 }], "wireframe_too_large"],
		[
			"nine table columns",
			[{ type: "table", columns: Array.from({ length: 9 }, (_, i) => `C${i}`) }],
			"wireframe_too_large",
		],
	])("rejects %s with a repair hint", (_name, children, code) => {
		const issues = issuesOf(wireframe(children));
		expect(issues.map((issue) => issue.code)).toContain(code);
		for (const issue of issues) expect(issue.hint.length).toBeGreaterThan(10);
	});

	it("rejects screens it cannot draw", () => {
		const screen = (id: string) => ({ id, name: id, children: [{ type: "divider" }] });
		expect(codes({ ...wireframe([]), screens: [{ ...screen("a"), children: [] }] })).toEqual([
			"empty_wireframe_screen",
		]);
		expect(codes({ ...wireframe([]), screens: [screen("a"), screen("a")] })).toEqual([
			"duplicate_screen_id",
		]);
		expect(codes({ ...wireframe([]), screens: [screen("a:b")] })).toEqual(["invalid_screen_id"]);
		expect(
			codes({
				...wireframe([]),
				screens: Array.from({ length: WIREFRAME_MAX_SCREENS + 1 }, (_, i) => screen(`s${i}`)),
			}),
		).toEqual(["wireframe_too_large"]);
	});

	it("bounds the size and depth of a wireframe", () => {
		expect(
			codes(
				wireframe(
					Array.from({ length: WIREFRAME_MAX_COMPONENTS + 1 }, () => ({ type: "divider" })),
				),
			),
		).toEqual(["wireframe_too_large"]);
		let nested: Record<string, unknown> = { type: "divider" };
		for (let depth = 0; depth < WIREFRAME_MAX_DEPTH; depth += 1)
			nested = { type: "column", children: [nested] };
		expect(codes(wireframe([nested]))).toEqual(["wireframe_too_large"]);
		// Six full tables of eight by eight draw more than one scene holds.
		const table = {
			type: "table",
			columns: Array.from({ length: 8 }, (_, i) => `C${i}`),
			rows: 8,
		};
		expect(codes(wireframe(Array.from({ length: 8 }, () => table)))).toEqual([
			"wireframe_too_large",
		]);
	});

	it("reads the ways people write a wireframe", () => {
		const resolved = resolveWireframeShorthand({
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
		expect(resolved).toEqual({
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
		expect(getWireframeValidationIssues(parseWireframeDiagram(resolved))).toEqual([]);
	});

	it("reads a lone screen written at the top", () => {
		const resolved = resolveWireframeShorthand({
			id: "login",
			title: "Login",
			type: "wireframe",
			device: "phone",
			components: [{ type: "text-field", label: "Email" }],
		});
		expect(resolved).toEqual({
			id: "login",
			title: "Login",
			type: "wireframe",
			screens: [
				{
					id: "login",
					name: "Login",
					device: "mobile",
					children: [{ type: "input", label: "Email" }],
				},
			],
		});
	});
});

describe("wireframe input it must never misread", () => {
	const component = (children: unknown[]) =>
		resolveWireframeShorthand({
			id: "app",
			title: "App",
			type: "wireframe",
			screens: [{ name: "Home", children }],
		});
	const parsedIssue = (input: unknown) => {
		try {
			parseWireframeDiagram(input);
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	};

	it.each([
		["an object", { type: "heading", text: "Hi" }],
		["a string", "heading"],
		["null", null],
	])("leaves %s where a list belongs for the schema to reject", (_name, malformed) => {
		for (const input of [
			component([{ type: "card", children: malformed }]),
			component([{ type: "nav", items: malformed }]),
			component([{ type: "table", columns: malformed }]),
			resolveWireframeShorthand({ id: "app", title: "App", type: "wireframe", screens: malformed }),
			resolveWireframeShorthand({
				id: "app",
				title: "App",
				type: "wireframe",
				components: malformed,
			}),
			resolveWireframeShorthand({
				id: "app",
				title: "App",
				type: "wireframe",
				screens: [{ name: "Home", children: malformed }],
			}),
		]) {
			expect(JSON.stringify(input)).not.toBe(
				JSON.stringify(resolveWireframeShorthand({ id: "app", title: "App", type: "wireframe" })),
			);
			expect(parsedIssue(input), JSON.stringify(input)).toBeDefined();
		}
		// The malformed value survives normalization, so the rejection names it.
		expect(
			(
				component([{ type: "card", children: malformed }]) as {
					screens: [{ children: [{ children: unknown }] }];
				}
			).screens[0].children[0].children,
		).toEqual(malformed);
	});

	it("keeps an item it cannot read, an index past the items and a boolean active for the schema", () => {
		const [nav, tabs, other] = (
			component([
				{ type: "nav", items: [{ href: "/" }] },
				{ type: "tabs", items: ["A", "B"], active: 5 },
				{ type: "tabs", items: ["A"], active: true },
			]) as { screens: [{ children: unknown[] }] }
		).screens[0].children as [{ items: unknown[] }, { active: unknown }, { active: unknown }];
		expect(nav.items).toEqual([{ href: "/" }]);
		expect(tabs.active).toBe(5);
		expect(other.active).toBe(true);
	});

	it("keeps zero apart from absent", () => {
		expect(codes(wireframe([{ type: "text", lines: 0 }]))).toEqual(["invalid_wireframe_option"]);
		expect(codes(wireframe([{ type: "table", columns: ["A"], rows: 0 }]))).toEqual([
			"invalid_wireframe_option",
		]);
		expect(codes(wireframe([{ type: "heading", text: "Hi", level: 0 }]))).toEqual([
			"invalid_wireframe_option",
		]);
		expect(
			codes(wireframe([{ type: "grid", columns: 0, children: [{ type: "divider" }] }])),
		).toEqual(["invalid_wireframe_option"]);
		// A number written as a widget's words is those words, and 0 stays 0.
		const resolved = component([
			{ type: "heading", text: 0 },
			{ type: "input", label: "Seats", value: 0 },
			{ type: "tabs", items: [0, 1], active: 0 },
		]);
		expect((resolved as { screens: [{ children: unknown[] }] }).screens[0].children).toEqual([
			{ type: "heading", text: "0" },
			{ type: "input", label: "Seats", value: "0" },
			{ type: "tabs", items: ["0", "1"], active: "0" },
		]);
		expect(getWireframeValidationIssues(parseWireframeDiagram(resolved))).toEqual([]);
	});

	it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
		"rejects the inherited name %s as a type or device instead of crashing",
		(name) => {
			const typed = component([{ type: name }]);
			expect(
				(typed as { screens: [{ children: [{ type: unknown }] }] }).screens[0].children[0].type,
			).toBe(name);
			expect(parsedIssue(typed)).toContain("type");
			const device = resolveWireframeShorthand({
				id: "app",
				title: "App",
				type: "wireframe",
				screens: [{ name: "Home", device: name, children: [{ type: "divider" }] }],
			});
			expect((device as { screens: [{ device: unknown }] }).screens[0].device).toBe(name);
			expect(parsedIssue(device)).toContain("device");
		},
	);

	it("keeps an authored line break in every text", () => {
		const parsed = parseWireframeDiagram(
			wireframe([
				{ type: "heading", text: "Two\nlines" },
				{ type: "button", text: "Save\nnow" },
				{ type: "tabs", items: ["One\ntab", "Two"] },
			]),
		);
		expect(parsed.screens[0]!.children.map((entry) => entry.text ?? entry.items?.[0])).toEqual([
			"Two\nlines",
			"Save\nnow",
			"One\ntab",
		]);
	});
});

describe("wireframe navigation", () => {
	const flow = (first: unknown[], second: unknown[] = [{ type: "heading", text: "Done" }]) => ({
		id: "flow",
		title: "Flow",
		type: wireframeDiagramType,
		screens: [
			{ id: "signup", name: "Sign up", children: first },
			{ id: "done", name: "All done", children: second },
		],
	});

	it("opens another screen from a button or link", () => {
		const parsed = parseWireframeDiagram(
			flow([
				{ type: "button", text: "Continue", target: "done" },
				{ type: "link", text: "Skip", target: "done" },
			]),
		);
		expect(parsed.screens[0]!.children.map((component) => component.target)).toEqual([
			"done",
			"done",
		]);
	});

	it.each([
		[
			"an unknown screen",
			[{ type: "button", text: "Go", target: "nowhere" }],
			"unknown_wireframe_target",
		],
		[
			"its own screen",
			[{ type: "button", text: "Go", target: "signup" }],
			"unknown_wireframe_target",
		],
		[
			"a card",
			[{ type: "card", target: "done", children: [{ type: "divider" }] }],
			"invalid_wireframe_option",
		],
	])("rejects a target on %s with a repair hint", (_name, children, code) => {
		const issues = issuesOf(flow(children));
		expect(issues.map((issue) => issue.code)).toEqual([code]);
		expect(issues[0]!.hint).toMatch(/target/u);
	});

	it("reads a target written as a screen's name, a link or an alias", () => {
		const resolved = resolveWireframeShorthand({
			...flow([
				{ type: "button", text: "Continue", goTo: "All done" },
				{ type: "link", text: "Skip", href: "#done" },
				{ type: "button", label: "Next", navigatesTo: "ALL-DONE" },
				{ type: "button", text: "Elsewhere", target: "Nowhere" },
			]),
		}) as { screens: [{ children: { target?: string }[] }] };
		expect(resolved.screens[0].children.map((component) => component.target)).toEqual([
			"done",
			"done",
			"done",
			"Nowhere",
		]);
		expect(codes(resolved)).toEqual(["unknown_wireframe_target"]);
	});

	it("keeps a target that already names a screen exactly, even when another screen squashes alike", () => {
		const resolved = resolveWireframeShorthand({
			id: "flow",
			title: "Flow",
			type: wireframeDiagramType,
			screens: [
				{
					id: "sign-up",
					name: "Sign up",
					children: [{ type: "button", text: "Next", target: "signup" }],
				},
				{
					id: "signup",
					name: "Signup",
					children: [{ type: "button", text: "Back", target: "sign-up" }],
				},
			],
		}) as { screens: { children: { target?: string }[] }[] };
		expect(resolved.screens.map((screen) => screen.children[0]!.target)).toEqual([
			"signup",
			"sign-up",
		]);
		expect(codes(resolved)).toEqual([]);
	});
});
