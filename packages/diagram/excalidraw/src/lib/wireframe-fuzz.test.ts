import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseWireframeDiagram,
	WIREFRAME_DEVICES,
	wireframeComponents,
	wireframeElementEstimate,
	type WireframeDiagram,
	WireframeValidationError,
} from "@sketchi/diagram-core";
import {
	layoutWireframeDiagram,
	renderWireframeDiagram,
	wireframeBoxIssues,
	wireframeLayoutIssues,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, createExcalidrawFile, validateExcalidrawScene } from "./convert";

const WORDS = [
	"Save",
	"Orders",
	"Customer",
	"Revenue",
	"Settings",
	"Notifications",
	"Subscription",
	"Internationalization",
	"well-known",
	"sign-in",
	"$48,200",
	"2.1%",
	"22:00",
	"you@example.com",
	"注文履歴",
	"Überweisung",
	"Ação",
	"a",
	"of",
	"the",
	"weekly",
	"report",
	"dashboard",
	"two\nlines",
	"0",
];

/** A seeded random number source: a 32-bit LCG in exact integer arithmetic. */
function seeded(start: number) {
	let seed = start >>> 0;
	const random = () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return seed / 4_294_967_296;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const int = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
	const words = (low: number, high: number, limit = 60) => {
		let text = Array.from({ length: int(low, high) }, () => pick(WORDS)).join(" ");
		while (text.length > limit) text = text.slice(0, text.lastIndexOf(" "));
		return text || pick(WORDS);
	};
	return { random, pick, int, words };
}

type Random = ReturnType<typeof seeded>;
type Spec = Record<string, unknown>;

function widget(r: Random): Spec {
	const type = r.pick([
		"heading",
		"text",
		"text",
		"link",
		"badge",
		"button",
		"button",
		"input",
		"input",
		"textarea",
		"select",
		"checkbox",
		"radio",
		"toggle",
		"search",
		"tabs",
		"nav",
		"breadcrumbs",
		"avatar",
		"icon",
		"image",
		"chart",
		"table",
		"list",
		"divider",
	] as const);
	const items = () =>
		Array.from({ length: r.int(1, 7) }, (_, index) => `${r.words(1, 2, 24)} ${index}`);
	const state = r.random() < 0.15 ? { disabled: true } : {};
	switch (type) {
		case "heading":
			return { type, text: r.words(1, 6, 80), ...(r.random() < 0.6 ? { level: r.int(1, 3) } : {}) };
		case "text":
			return r.random() < 0.6 ? { type, text: r.words(2, 40, 280) } : { type, lines: r.int(1, 6) };
		case "link":
			return { type, text: r.words(1, 4), ...state };
		case "badge":
			return { type, text: r.words(1, 2) };
		case "button":
			return {
				type,
				text: r.words(1, 4),
				...(r.random() < 0.5 ? { variant: r.pick(["primary", "secondary"]) } : {}),
				...state,
			};
		case "input":
		case "textarea":
		case "select":
		case "search":
			return {
				type,
				...(type !== "search" && r.random() < 0.8 ? { label: r.words(1, 4) } : {}),
				...(r.random() < 0.5
					? { placeholder: r.words(1, 5) }
					: r.random() < 0.5
						? { value: r.words(1, 3) }
						: {}),
				...(type === "textarea" && r.random() < 0.5 ? { rows: r.int(1, 6) } : {}),
				...state,
			};
		case "checkbox":
		case "radio":
		case "toggle":
			return {
				type,
				label: r.words(1, 7),
				...(r.random() < 0.5 ? { checked: true } : {}),
				...state,
			};
		case "tabs":
		case "nav": {
			const list = items();
			return { type, items: list, ...(r.random() < 0.6 ? { active: r.pick(list) } : {}) };
		}
		case "breadcrumbs":
		case "list":
			return { type, items: items() };
		case "avatar":
		case "icon":
			return { type, ...(r.random() < 0.6 ? { label: r.words(1, 3) } : {}) };
		case "image":
			return {
				type,
				...(r.random() < 0.5 ? { label: r.words(1, 3) } : {}),
				...(r.random() < 0.6 ? { aspect: r.pick(["wide", "square", "tall"]) } : {}),
			};
		case "chart":
			return {
				type,
				...(r.random() < 0.5 ? { label: r.words(1, 5) } : {}),
				...(r.random() < 0.7 ? { kind: r.pick(["bar", "line", "pie"]) } : {}),
			};
		case "table":
			return {
				type,
				columns: Array.from({ length: r.int(1, 6) }, () => r.words(1, 2, 24)),
				...(r.random() < 0.6 ? { rows: r.int(1, 6) } : {}),
			};
		case "divider":
			return { type };
	}
}

function container(r: Random, depth: number, budget: { left: number }): Spec {
	const type = r.pick([
		"section",
		"card",
		"card",
		"row",
		"row",
		"column",
		"grid",
		"modal",
	] as const);
	const count = r.int(1, type === "grid" ? 6 : 4);
	const children = Array.from({ length: count }, () => component(r, depth + 1, budget));
	return {
		type,
		...(type !== "row" && type !== "column" && type !== "grid" && r.random() < 0.7
			? { title: r.words(1, 5) }
			: {}),
		...(type === "grid" ? { columns: r.int(1, 4) } : {}),
		...(r.random() < 0.25
			? {
					align:
						type === "row"
							? r.pick(["start", "center", "end", "between"])
							: r.pick(["start", "center", "end"]),
				}
			: {}),
		children,
	};
}

function component(r: Random, depth: number, budget: { left: number }): Spec {
	budget.left -= 1;
	return depth < 4 && budget.left > 4 && r.random() < 0.3 ? container(r, depth, budget) : widget(r);
}

/**
 * Seeded random wireframes: one to four screens on every device, each with a
 * header, footer, sidebars and modal or none, and a random tree of every
 * component, with long, hyphenated and non-Latin words and every state.
 */
function randomWireframes(count: number, start: number): WireframeDiagram[] {
	const r = seeded(start);
	return Array.from({ length: count }, (_, index) => {
		// A draw past the contract's size bounds is drawn again.
		for (;;) {
			const diagram = randomWireframe(r, `random-${start}-${index}`);
			if (diagram) return diagram;
		}
	});
}

function randomWireframe(r: Random, id: string): WireframeDiagram | undefined {
	{
		const screens = Array.from({ length: r.random() < 0.7 ? 1 : r.int(2, 4) }, (_, at) => {
			const budget = { left: r.int(6, 34) };
			const children: Spec[] = [];
			if (r.random() < 0.5)
				children.push({
					type: "header",
					children: Array.from({ length: r.int(1, 4) }, () => widget(r)),
				});
			if (r.random() < 0.3)
				children.push({
					type: "sidebar",
					...(r.random() < 0.3 ? { side: "right" } : {}),
					children: [
						{
							type: "nav",
							items: ["Home", "Orders", "Customer success", "Settings"],
							active: "Home",
						},
						...(r.random() < 0.5 ? [widget(r)] : []),
					],
				});
			while (budget.left > 0) children.push(component(r, 1, budget));
			if (r.random() < 0.3)
				children.push({
					type: "footer",
					...(r.random() < 0.5 ? { align: "end" } : {}),
					children: Array.from({ length: r.int(1, 3) }, () => widget(r)),
				});
			if (r.random() < 0.1)
				children.push({ type: "modal", title: r.words(1, 4), children: [widget(r), widget(r)] });
			return {
				id: `screen-${at}`,
				name: r.words(1, 3),
				device: r.pick(WIREFRAME_DEVICES),
				...(r.random() < 0.15 ? { align: r.pick(["center", "end"]) } : {}),
				children,
			};
		});
		// Some buttons and links open another screen.
		if (screens.length > 1) {
			const ids = screens.map((screen) => screen.id);
			const open = (component: Spec, screen: string): Spec => {
				if ((component["type"] === "button" || component["type"] === "link") && r.random() < 0.3) {
					const others = ids.filter((other) => other !== screen);
					return { ...component, target: r.pick(others) };
				}
				const children = component["children"];
				return Array.isArray(children)
					? { ...component, children: (children as Spec[]).map((child) => open(child, screen)) }
					: component;
			};
			for (const screen of screens)
				screen.children = screen.children.map((child) => open(child, screen.id));
		}
		try {
			return parseWireframeDiagram({ id, title: "Random wireframe", type: "wireframe", screens });
		} catch (error) {
			if (
				error instanceof WireframeValidationError &&
				error.issues.every((issue) => issue.code === "wireframe_too_large")
			)
				return undefined;
			throw error;
		}
	}
}

/** CI draws a small fixed sample; `WIREFRAME_FUZZ=full` runs the local proof. */
const FULL = process.env["WIREFRAME_FUZZ"] === "full";
const WIREFRAMES = FULL ? 400 : 8;
const SEEDS = FULL ? [5, 23, 61] : [5];

describe("wireframe fuzz", () => {
	for (const seed of SEEDS)
		it(`draws ${WIREFRAMES} random wireframes of seed ${seed} cleanly`, () => {
			const defects: string[] = [];
			// A screen may grow past its device to hold a word no wrap can break; rare, and counted.
			const shortfalls: string[] = [];
			for (const diagram of randomWireframes(WIREFRAMES, seed)) {
				const scene = renderWireframeDiagram(diagram);
				const exported = convertSceneToExcalidraw(scene);
				const reloaded = JSON.parse(
					JSON.stringify(createExcalidrawFile(exported)),
				) as typeof exported;
				const boxes = wireframeBoxIssues(layoutWireframeDiagram(diagram));
				const estimate =
					diagram.screens.length +
					[...wireframeComponents(diagram)].reduce(
						(sum, { component }) => sum + wireframeElementEstimate(component),
						0,
					);
				const frames = scene.elements.filter((element) => element.type === "frame");
				const sheet = {
					width:
						Math.max(...frames.map((frame) => frame.x + frame.width)) -
						Math.min(...frames.map((frame) => frame.x)),
					height:
						Math.max(...frames.map((frame) => frame.y + frame.height)) -
						Math.min(...frames.map((frame) => frame.y)),
				};
				const problems = [
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...validateExcalidrawScene(reloaded).issues.map((issue) => `reloaded: ${issue.message}`),
					...wireframeLayoutIssues(scene).map((issue) => issue.message),
					...boxes.filter((issue) => issue.code !== "screen-widened").map((issue) => issue.message),
					...(scene.elements.length > estimate
						? [`${scene.elements.length} elements over the estimate ${estimate}`]
						: []),
					...(sheet.width / sheet.height > 2.45
						? [`aspect ${(sheet.width / sheet.height).toFixed(2)}`]
						: []),
				];
				const name = `${diagram.id} (${[...wireframeComponents(diagram)].length} components)`;
				if (problems.length > 0) defects.push(`${name}: ${problems.slice(0, 3).join("; ")}`);
				const unrouted = layoutWireframeDiagram(diagram).navigations.filter(
					(navigation) => !navigation.routed,
				);
				if (unrouted.length > 0)
					shortfalls.push(`${name}: ${unrouted.length} navigation arrows without a route`);
				const widened = boxes.filter((issue) => issue.code === "screen-widened");
				if (widened.length > 0)
					shortfalls.push(`${name}: ${widened.map((issue) => issue.message).join("; ")}`);
			}
			if (FULL)
				console.info(
					`seed ${seed}: ${shortfalls.length} shortfalls of ${WIREFRAMES}\n${shortfalls.join("\n")}`,
				);
			expect(defects).toEqual([]);
			expect(shortfalls.length, shortfalls.join("\n")).toBeLessThanOrEqual(WIREFRAMES / 50);
		});
});
