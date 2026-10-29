import {
	getCanvasValidationIssues,
	parseWireframeDiagram,
	wireframeComponents,
	wireframeElementEstimate,
	wireframeFixture,
	wireframeStressFixtures,
} from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { renderDiagram } from "../diagram.js";
import type { NodeSceneElement, RenderedDiagramScene, TextSceneElement } from "../scene.js";
import {
	layoutWireframeDiagram,
	renderWireframeDiagram,
	WIREFRAME_ACCENT,
	WIREFRAME_DEVICE_METRICS,
} from "../wireframe.js";
import {
	wireframeBoxIssues,
	wireframeLayoutIssues,
	wireframeTextBounds,
} from "../wireframe-readout.js";

const screen = (children: unknown[], extra: Record<string, unknown> = {}) =>
	parseWireframeDiagram({
		id: "test",
		title: "Test",
		type: "wireframe",
		screens: [{ id: "s", name: "Screen", device: "desktop", children, ...extra }],
	});

const nodes = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is NodeSceneElement => element.type === "node");
const texts = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is TextSceneElement => element.type === "text");
const byId = (scene: RenderedDiagramScene, id: string) => {
	const element = scene.elements.find((candidate) => candidate.id === id);
	if (!element) throw new Error(`No element ${id}`);
	return element;
};
const node = (scene: RenderedDiagramScene, id: string) => byId(scene, id) as NodeSceneElement;
const boxOf = (diagram: ReturnType<typeof screen>, path: string) => {
	const found = layoutWireframeDiagram(diagram)
		.screens.flatMap((entry) => entry.components)
		.find((component) => component.path === path);
	if (!found) throw new Error(`No component at ${path}`);
	return found.box;
};

function expectClean(
	scene: RenderedDiagramScene,
	diagram: Parameters<typeof layoutWireframeDiagram>[0],
) {
	expect(getCanvasValidationIssues(scene)).toEqual([]);
	expect(wireframeLayoutIssues(scene)).toEqual([]);
	expect(wireframeBoxIssues(layoutWireframeDiagram(diagram))).toEqual([]);
}

describe("wireframe renderer", () => {
	it("renders the fixture into a valid deterministic scene, one frame per screen", () => {
		const scene = renderDiagram(wireframeFixture);
		expect(scene.diagramId).toBe("mobile-login");
		expectClean(scene, wireframeFixture);
		expect(renderDiagram(wireframeFixture)).toEqual(scene);
		const frames = scene.elements.filter((element) => element.type === "frame");
		expect(frames).toMatchObject([{ id: "frame:login", name: "Login", width: 390 }]);
		expect(
			scene.elements
				.filter((element) => element.type !== "frame")
				.every((element) => element.frameId === "frame:login"),
		).toBe(true);
	});

	it.each(Object.entries(wireframeStressFixtures))(
		"lays out %s with nothing overlapping or overflowing",
		(_name, diagram) => {
			expectClean(renderWireframeDiagram(diagram), diagram);
		},
	);

	it("sizes each screen to its device and grows it with its content", () => {
		for (const device of ["desktop", "tablet", "mobile"] as const) {
			const layout = layoutWireframeDiagram(screen([{ type: "heading", text: "Hi" }], { device }));
			expect(layout.screens[0]!.frame).toMatchObject({
				width: WIREFRAME_DEVICE_METRICS[device].width,
				height: WIREFRAME_DEVICE_METRICS[device].minHeight,
			});
		}
		const long = screen(Array.from({ length: 40 }, () => ({ type: "input", label: "Field" })));
		expect(layoutWireframeDiagram(long).screens[0]!.frame.height).toBeGreaterThan(2000);
	});

	it("spans the header across the top, the footer along the bottom, and sidebars down their sides", () => {
		const diagram = screen([
			{ type: "footer", children: [{ type: "text", text: "© Acme" }] },
			{ type: "sidebar", children: [{ type: "nav", items: ["Home", "Billing"] }] },
			{ type: "sidebar", side: "right", children: [{ type: "text", text: "Help" }] },
			{ type: "header", children: [{ type: "heading", text: "Acme" }] },
			{ type: "heading", text: "Body" },
		]);
		const frame = layoutWireframeDiagram(diagram).screens[0]!.frame;
		const header = boxOf(diagram, "3");
		const footer = boxOf(diagram, "0");
		const left = boxOf(diagram, "1");
		const right = boxOf(diagram, "2");
		const body = boxOf(diagram, "4");
		expect(header).toMatchObject({ x: frame.x, y: frame.y, width: frame.width });
		expect(footer).toMatchObject({ x: frame.x, width: frame.width });
		expect(footer.y + footer.height).toBe(frame.y + frame.height);
		expect(left).toMatchObject({ x: frame.x, y: header.y + header.height, width: 240 });
		expect(left.y + left.height).toBe(footer.y);
		expect(right.x + right.width).toBe(frame.x + frame.width);
		expect(body.x).toBeGreaterThan(left.x + left.width);
		expect(body.x + body.width).toBeLessThan(right.x);
		expectClean(renderWireframeDiagram(diagram), diagram);
	});

	it("stacks a sidebar into the content on a phone", () => {
		const diagram = screen(
			[
				{ type: "sidebar", children: [{ type: "nav", items: ["Home", "Billing"] }] },
				{ type: "heading", text: "Body" },
			],
			{ device: "mobile" },
		);
		const sidebar = boxOf(diagram, "0");
		expect(sidebar.width).toBe(390 - 2 * 16);
		expect(boxOf(diagram, "1").y).toBeGreaterThan(sidebar.y + sidebar.height);
	});

	it("hugs buttons to their text, stretches inputs, and fills primary actions with the accent", () => {
		const diagram = screen([
			{ type: "button", text: "Go", variant: "primary" },
			{ type: "button", text: "Download the quarterly report" },
			{ type: "input", label: "Email" },
		]);
		const scene = renderWireframeDiagram(diagram);
		const content = 1280 - 64;
		expect(boxOf(diagram, "0").width).toBe(80);
		expect(boxOf(diagram, "1").width).toBeLessThan(300);
		expect(boxOf(diagram, "2").width).toBe(content);
		expect(node(scene, "wf:s:0:box")).toMatchObject({
			fillColor: WIREFRAME_ACCENT,
			rendererRole: "wireframe-widget",
		});
		expect(node(scene, "wf:s:1:box").fillColor).toBe("#ffffff");
		// A button's label is bound to it.
		expect(byId(scene, "wf:s:0:label")).toMatchObject({ containerId: "wf:s:0:box", text: "Go" });
	});

	it("splits a grid evenly and drops columns before a child would overflow", () => {
		const card = (title: string) => ({
			type: "card",
			title,
			children: [{ type: "heading", text: "42" }],
		});
		const wide = screen([
			{ type: "grid", columns: 3, children: [card("A"), card("B"), card("C")] },
		]);
		const widths = ["0.0", "0.1", "0.2"].map((path) => boxOf(wide, path).width);
		expect(new Set(widths).size).toBe(1);
		expect(new Set(["0.0", "0.1", "0.2"].map((path) => boxOf(wide, path).y)).size).toBe(1);
		const narrow = screen(
			[
				{
					type: "grid",
					columns: 3,
					children: [card("Unread notifications"), card("Drafts"), card("Scheduled")],
				},
			],
			{ device: "mobile" },
		);
		expect(boxOf(narrow, "0.2").y).toBeGreaterThan(boxOf(narrow, "0.0").y);
		expectClean(renderWireframeDiagram(narrow), narrow);
	});

	it("gives cards in a row one height and wraps a row too long for its line", () => {
		const diagram = screen(
			[
				{
					type: "row",
					children: [
						{ type: "card", title: "Short", children: [{ type: "text", text: "One" }] },
						{ type: "card", title: "Tall", children: [{ type: "text", lines: 6 }] },
					],
				},
				{
					type: "row",
					children: Array.from({ length: 8 }, (_, i) => ({ type: "badge", text: `Category ${i}` })),
				},
			],
			{ device: "mobile" },
		);
		expect(boxOf(diagram, "0.0").height).toBe(boxOf(diagram, "0.1").height);
		const badges = Array.from({ length: 8 }, (_, i) => boxOf(diagram, `1.${i}`));
		expect(new Set(badges.map((box) => box.y)).size).toBeGreaterThan(1);
		expectClean(renderWireframeDiagram(diagram), diagram);
	});

	it("levels what follows the titles of cards side by side, however the titles wrap", () => {
		const card = (title: string) => ({
			type: "card",
			title,
			children: [{ type: "heading", level: 2, text: "$48,200" }],
		});
		for (const container of ["row", "grid"]) {
			const diagram = screen([
				{
					type: container,
					...(container === "grid" ? { columns: 3 } : {}),
					children: [
						card("Revenue"),
						card("Average revenue per account this quarter"),
						card("Churn"),
					],
				},
			]);
			const values = ["0.0.0", "0.1.0", "0.2.0"].map((path) => boxOf(diagram, path).y);
			expect(new Set(values).size, container).toBe(1);
			expectClean(renderWireframeDiagram(diagram), diagram);
		}
	});

	it("wraps long text at whole words inside its parent", () => {
		const sentence =
			"Internationalization requires every component to handle unexpectedly long translated strings gracefully";
		const title = "Internationalization handles unexpectedly long strings";
		const diagram = screen(
			[{ type: "card", title, children: [{ type: "text", text: sentence }] }],
			{
				device: "mobile",
			},
		);
		const scene = renderWireframeDiagram(diagram);
		const words = new Set([...sentence.split(" "), ...title.split(" ")]);
		for (const text of texts(scene))
			for (const word of text.text.split(/\s+/u)) expect(words.has(word), word).toBe(true);
		expectClean(scene, diagram);
	});

	it("measures a row's title as the heading it draws, so a grid drops a column before it overflows", () => {
		const row = {
			type: "row",
			title: "Internationalization",
			children: [{ type: "button", text: "Go" }],
		};
		const diagram = screen([{ type: "grid", columns: 2, children: [row, row] }], {
			device: "mobile",
		});
		const scene = renderDiagram(diagram);
		expect(scene.elements.find((element) => element.type === "frame")).toMatchObject({
			width: 390,
		});
		expectClean(scene, diagram);
	});

	it("marks only the first of repeated items active, so every element keeps its own id", () => {
		for (const type of ["tabs", "nav"]) {
			const diagram = screen([{ type, items: ["Orders", "Orders"], active: "Orders" }]);
			const scene = renderDiagram(diagram);
			const ids = scene.elements.map((element) => element.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(ids.filter((id) => id.endsWith(":active"))).toEqual(["wf:s:0:active"]);
			expectClean(scene, diagram);
		}
	});

	it("wraps a long tab or nav label at whole words rather than widening a phone", () => {
		const label = "Manage your account and notification preferences";
		for (const children of [
			[{ type: "tabs", items: ["Profile", label], active: "Profile" }],
			[{ type: "nav", items: ["Home", label], active: "Home" }],
			[{ type: "sidebar", children: [{ type: "nav", items: ["Home", label] }] }],
		]) {
			const diagram = screen(children, { device: "mobile" });
			const scene = renderDiagram(diagram);
			expect(scene.elements.find((element) => element.type === "frame")).toMatchObject({
				width: 390,
			});
			expectClean(scene, diagram);
		}
	});

	it("draws a table's headers and capped placeholder rows, and stacks its rows when columns cannot fit", () => {
		const columns = ["Order", "Customer", "Date", "Total", "Status"];
		const wide = screen([{ type: "table", columns, rows: 3 }]);
		const scene = renderWireframeDiagram(wide);
		expect(
			columns.map((_, index) => (byId(scene, `wf:s:0:header-${index}`) as TextSceneElement).text),
		).toEqual(columns);
		expect(scene.elements.filter((element) => element.id.startsWith("wf:s:0:cell-"))).toHaveLength(
			15,
		);
		const narrow = screen(
			[
				{
					type: "table",
					columns: ["Subscription", "Renewal date", "Seats", "Monthly amount", "Status"],
					rows: 2,
				},
			],
			{ device: "mobile" },
		);
		const stacked = renderWireframeDiagram(narrow);
		expect(stacked.elements.some((element) => element.id === "wf:s:0:header-1-4")).toBe(true);
		expectClean(stacked, narrow);
	});

	it("shows each widget's state", () => {
		const diagram = screen([
			{ type: "tabs", items: ["General", "Notifications", "Billing"], active: "Notifications" },
			{ type: "toggle", label: "Product updates", checked: true },
			{ type: "toggle", label: "Marketing emails" },
			{ type: "checkbox", label: "Remember me", checked: true },
			{ type: "radio", label: "Monthly", checked: true },
			{ type: "select", label: "Start time", value: "22:00" },
			{ type: "input", label: "Quantity", value: "1" },
			{ type: "input", label: "Name", placeholder: "Ada" },
			{ type: "button", text: "Delete", disabled: true },
		]);
		const scene = renderWireframeDiagram(diagram);
		expect((byId(scene, "wf:s:0:item-1") as TextSceneElement).textColor).toBe(WIREFRAME_ACCENT);
		expect((byId(scene, "wf:s:0:item-0") as TextSceneElement).textColor).not.toBe(WIREFRAME_ACCENT);
		const underline = byId(scene, "wf:s:0:active");
		const tab = wireframeTextBounds(byId(scene, "wf:s:0:item-1") as TextSceneElement);
		expect(
			underline.type === "line" &&
				underline.points[0].x < tab.left &&
				underline.points[1].x > tab.right,
		).toBe(true);
		const onTrack = node(scene, "wf:s:1:track");
		const onKnob = node(scene, "wf:s:1:knob");
		const offKnob = node(scene, "wf:s:2:knob");
		expect(onTrack.fillColor).toBe(WIREFRAME_ACCENT);
		expect(onKnob.x - onTrack.x).toBeGreaterThan(offKnob.x - node(scene, "wf:s:2:track").x);
		expect(scene.elements.some((element) => element.id === "wf:s:3:check-0")).toBe(true);
		expect(scene.elements.some((element) => element.id === "wf:s:4:dot")).toBe(true);
		expect(byId(scene, "wf:s:5:value")).toMatchObject({ text: "22:00", textColor: "#1a1712" });
		expect(byId(scene, "wf:s:6:value")).toMatchObject({ text: "1" });
		expect(byId(scene, "wf:s:7:placeholder")).toMatchObject({ text: "Ada", textColor: "#868e96" });
		expect(node(scene, "wf:s:8:box").opacity).toBe(50);
		expectClean(scene, diagram);
	});

	it("highlights the active nav item and stacks a sidebar's nav", () => {
		const diagram = screen([
			{
				type: "sidebar",
				children: [{ type: "nav", items: ["Overview", "Orders"], active: "Orders" }],
			},
			{ type: "nav", items: ["Docs", "Pricing"], active: "Docs" },
		]);
		const scene = renderWireframeDiagram(diagram);
		const [first, second] = ["wf:s:0.0:item-0", "wf:s:0.0:item-1"].map(
			(id) => byId(scene, id) as TextSceneElement,
		);
		expect(second!.y).toBeGreaterThan(first!.y);
		expect(node(scene, "wf:s:0.0:active").fillColor).toBe("#e7f5ff");
		const [docs, pricing] = ["wf:s:1:item-0", "wf:s:1:item-1"].map(
			(id) => byId(scene, id) as TextSceneElement,
		);
		expect(pricing!.y).toBe(docs!.y);
	});

	it("floats a modal over its screen behind a backdrop", () => {
		const diagram = wireframeStressFixtures["tabletModal"]!;
		const scene = renderWireframeDiagram(diagram);
		const scrim = node(scene, "wf:projects:scrim");
		const frame = layoutWireframeDiagram(diagram).screens[0]!.frame;
		expect(scrim).toMatchObject({
			x: frame.x,
			y: frame.y,
			width: frame.width,
			height: frame.height,
			opacity: 30,
		});
		const modal = node(scene, "wf:projects:2:box");
		expect(Math.abs(modal.x + modal.width / 2 - (frame.x + frame.width / 2))).toBeLessThanOrEqual(
			1,
		);
		expect(scene.elements.indexOf(modal)).toBeGreaterThan(scene.elements.indexOf(scrim));
		// A screen that is only a dialog needs no backdrop.
		const alone = renderWireframeDiagram(
			screen([{ type: "modal", title: "Hi", children: [{ type: "text", text: "Body" }] }]),
		);
		expect(alone.elements.some((element) => element.id === "wf:s:scrim")).toBe(false);
	});

	it("groups each component, and everything inside a card with the card", () => {
		const diagram = screen([
			{
				type: "card",
				title: "Plan",
				children: [
					{ type: "button", text: "Upgrade" },
					{ type: "row", children: [{ type: "badge", text: "Pro" }] },
				],
			},
		]);
		const scene = renderWireframeDiagram(diagram);
		expect(node(scene, "wf:s:0:box").groupIds).toEqual(["group:s:0"]);
		expect(node(scene, "wf:s:0.0:box").groupIds).toEqual(["group:s:0.0", "group:s:0"]);
		// A row draws nothing of its own, so it adds no group.
		expect(node(scene, "wf:s:0.1.0:box").groupIds).toEqual(["group:s:0.1.0", "group:s:0"]);
	});

	it("wraps a sheet of screens so it reads no wider than 2.45:1", () => {
		const screens = Array.from({ length: 6 }, (_, index) => ({
			id: `s${index}`,
			name: `Step ${index + 1}`,
			device: "desktop",
			children: [{ type: "heading", text: `Step ${index + 1}` }],
		}));
		const diagram = parseWireframeDiagram({
			id: "flow",
			title: "Flow",
			type: "wireframe",
			screens,
		});
		const scene = renderWireframeDiagram(diagram);
		expect(scene.width / scene.height).toBeLessThanOrEqual(2.45);
		const frames = layoutWireframeDiagram(diagram).screens.map((entry) => entry.frame);
		expect(frames[1]!.y).toBe(frames[0]!.y);
		expect(frames.at(-1)!.y).toBeGreaterThan(frames[0]!.y);
		expect(wireframeLayoutIssues(scene)).toEqual([]);
		const phones = parseWireframeDiagram({
			id: "flow",
			title: "Flow",
			type: "wireframe",
			screens: screens.slice(0, 3).map((entry) => ({ ...entry, device: "mobile" })),
		});
		const row = layoutWireframeDiagram(phones).screens.map((entry) => entry.frame.y);
		expect(new Set(row).size).toBe(1);
	});

	it("never draws more than the contract's element estimate", () => {
		for (const diagram of [wireframeFixture, ...Object.values(wireframeStressFixtures)]) {
			const estimate =
				diagram.screens.length +
				[...wireframeComponents(diagram)].reduce(
					(sum, { component }) => sum + wireframeElementEstimate(component),
					0,
				);
			expect(renderWireframeDiagram(diagram).elements.length, diagram.id).toBeLessThanOrEqual(
				estimate + 1,
			);
		}
	});

	it("draws an authored line break as one, in every text", () => {
		const diagram = parseWireframeDiagram({
			id: "breaks",
			title: "Breaks",
			type: "wireframe",
			screens: [
				{
					id: "s",
					name: "Line\nbreaks",
					device: "mobile",
					children: [
						{
							type: "header",
							title: "Acme\nInc",
							children: [{ type: "nav", items: ["Home\npage", "Docs"], active: "Home\npage" }],
						},
						{ type: "heading", text: "Two\nlines" },
						{ type: "text", text: "First line\n\nThird line" },
						{ type: "badge", text: "New\nbadge" },
						{ type: "button", text: "Save\nnow", variant: "primary" },
						{ type: "link", text: "Read\nmore" },
						{ type: "input", label: "Full\nname", placeholder: "Ada\nLovelace" },
						{ type: "checkbox", label: "Remember\nme", checked: true },
						{ type: "toggle", label: "Dark\nmode", checked: true },
						{ type: "tabs", items: ["One\ntab", "Two"], active: "Two" },
						{ type: "breadcrumbs", items: ["Home\nbase", "Docs"] },
						{ type: "list", items: ["Item\none", "Item two"] },
						{
							type: "card",
							title: "Card\ntitle",
							children: [{ type: "image", label: "Hero\nshot" }],
						},
						{ type: "chart", label: "Chart\ntitle" },
						{ type: "table", columns: ["Order\nID", "Total"], rows: 2 },
						{ type: "avatar", label: "Ada\nLovelace" },
						{ type: "divider" },
					],
				},
			],
		});
		const scene = renderWireframeDiagram(diagram);
		expectClean(scene, diagram);
		const drawn = texts(scene).map((text) => text.text);
		for (const broken of [
			"Two\nlines",
			"Save\nnow",
			"Full\nname",
			"One\ntab",
			"Order\nID",
			"Card\ntitle",
			"Acme\nInc",
		])
			expect(
				drawn.some((text) => text.includes(broken)),
				broken,
			).toBe(true);
		expect(drawn.some((text) => text.includes("First line\n\nThird line"))).toBe(true);
		expect(scene.elements.find((element) => element.type === "frame")).toMatchObject({
			name: "Line breaks",
		});
		expect(byId(scene, "wf:s:15:label")).toMatchObject({ text: "AL" });
	});

	it("keeps touch targets on a phone at least 44 tall", () => {
		const diagram = screen(
			[
				{ type: "link", text: "Forgot password?" },
				{ type: "checkbox", label: "Remember me" },
				{ type: "toggle", label: "Dark mode" },
				{ type: "tabs", items: ["A", "B"] },
				{ type: "button", text: "Sign in" },
				{ type: "icon", label: "Menu" },
			],
			{ device: "mobile" },
		);
		for (const path of ["0", "1", "2", "3", "4", "5"])
			expect(boxOf(diagram, path).height).toBeGreaterThanOrEqual(44);
		expect(nodes(renderWireframeDiagram(diagram)).length).toBeGreaterThan(0);
	});
});
