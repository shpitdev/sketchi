import { describe, expect, it } from "vitest";

import {
	CANVAS_ICON_ELEMENT,
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	canvasIconElementBox,
	canvasBoundTextBox,
	canvasBoundTextInset,
	canvasNodeIconBand,
	canvasNodeIconBox,
	embedCanvasIcons,
	getCanvasValidationIssues,
	type CanvasFrameElement,
	type CanvasIconAsset,
	type CanvasIconElement,
	type CanvasShapeElement,
	type CanvasSpec,
} from "./canvas";
import { drawnIconSlug } from "./icon";
import type { IconRecipe } from "./icon-recipe";

const DOCKER: CanvasIconAsset = {
	name: "Docker",
	svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
};

function node(id: string, overrides: Partial<CanvasShapeElement> = {}): CanvasShapeElement {
	return {
		type: "node",
		id,
		nodeId: id,
		shape: "rectangle",
		x: 0,
		y: 0,
		width: 184,
		height: 80,
		label: "Build",
		...overrides,
	};
}

function canvas(
	elements: (CanvasShapeElement | CanvasFrameElement | CanvasIconElement)[],
	overrides: Partial<CanvasSpec> = {},
): CanvasSpec {
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: "icons",
		title: "Icons",
		width: 400,
		height: 300,
		accentColor: "#111827",
		backgroundColor: "#ffffff",
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
		...overrides,
	};
}

describe("node icon geometry", () => {
	it("centers the icon at the top of each shape's bound-text box", () => {
		const icon = { slug: "docker", size: 28 };
		expect(canvasNodeIconBox(node("r", { icon, x: 10, y: 20, height: 80 }))).toEqual({
			x: 88,
			y: 29,
			width: 28,
			height: 28,
		});

		const ellipse = node("e", {
			icon: { slug: "docker", size: 24 },
			shape: "ellipse",
			height: 100,
		});
		expect(canvasBoundTextInset(ellipse).y).toBeCloseTo(5 + 50 * (1 - Math.SQRT1_2));
		expect(canvasNodeIconBox(ellipse)?.y).toBeCloseTo(
			canvasBoundTextInset(ellipse).y + CANVAS_NODE_ICON.gap,
		);

		const diamond = node("d", {
			icon: { slug: "docker", size: 20 },
			shape: "diamond",
			width: 200,
			height: 120,
		});
		expect(canvasBoundTextInset(diamond)).toEqual({ x: 55, y: 35 });
		expect(canvasNodeIconBox(diamond)).toEqual({
			x: 90,
			y: 39,
			width: 20,
			height: 20,
		});
		expect(canvasNodeIconBox(node("plain"))).toBeUndefined();
	});

	it("mirrors Excalidraw's bound-text box for each container shape", () => {
		expect(canvasBoundTextBox(node("r", { width: 184, height: 80 }))).toEqual({
			width: 174,
			height: 70,
		});
		expect(canvasBoundTextBox(node("e", { shape: "ellipse", width: 200, height: 100 }))).toEqual({
			width: 131,
			height: 61,
		});
		expect(canvasBoundTextBox(node("d", { shape: "diamond", width: 229, height: 115 }))).toEqual({
			width: 105,
			height: 48,
		});
	});

	it("reserves the icon plus a gap above and below it", () => {
		expect(canvasNodeIconBand(undefined)).toBe(0);
		expect(canvasNodeIconBand({ slug: "docker", size: 28 })).toBe(28 + CANVAS_NODE_ICON.gap * 2);
	});
});

describe("embedCanvasIcons", () => {
	it("embeds one asset per slug, drops unknown icons, and replaces authored assets", () => {
		const icon = { slug: "docker", size: 28 };
		const result = embedCanvasIcons(
			canvas(
				[
					node("a", { icon }),
					node("b", { icon }),
					node("c", { icon: { slug: "made-up", size: 28 } }),
					node("d", { icon: { slug: "Not A Slug", size: 28 } }),
				],
				{ icons: { docker: { name: "Forged", svg: "<svg onload=x>" } } },
			),
			(slug) => (slug === "docker" ? DOCKER : undefined),
		);

		expect(result.scene.icons).toEqual({ docker: DOCKER });
		expect(
			result.scene.elements.map((element) =>
				element.type === "node" ? element.icon?.slug : undefined,
			),
		).toEqual(["docker", "docker", undefined, undefined]);
		expect(result.dropped).toEqual([
			{ elementId: "c", index: 2, reason: "unavailable", slug: "made-up" },
			{ elementId: "d", index: 3, reason: "unavailable", slug: "Not A Slug" },
		]);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});

	it("omits the icons map when nothing is embedded", () => {
		const result = embedCanvasIcons(canvas([node("a")]), () => DOCKER);
		expect("icons" in result.scene).toBe(false);
		expect(result.dropped).toEqual([]);
	});

	it("drops oversized assets and icons past the scene budget in element order", () => {
		const large = (name: string): CanvasIconAsset => ({
			name,
			svg: `<svg>${"x".repeat(CANVAS_NODE_ICON.maxAssetBytes - 11)}</svg>`,
		});
		const slugs = Array.from({ length: 14 }, (_, index) => `mark-${index}`);
		const result = embedCanvasIcons(
			canvas([
				node("huge", { icon: { slug: "huge", size: 28 } }),
				...slugs.map((slug) => node(slug, { icon: { slug, size: 28 } })),
			]),
			(slug) =>
				slug === "huge"
					? {
							name: "Huge",
							svg: "x".repeat(CANVAS_NODE_ICON.maxAssetBytes + 1),
						}
					: large(slug),
		);

		expect(Object.keys(result.scene.icons ?? {})).toEqual(slugs.slice(0, 12));
		expect(result.dropped.map(({ slug, reason }) => [slug, reason])).toEqual([
			["huge", "unavailable"],
			["mark-12", "budget"],
			["mark-13", "budget"],
		]);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});
});

const DOCKER_RECIPE = {
	parts: [{ kind: "rect", x: 2, y: 6, width: 20, height: 12, rounded: true, fill: "#2496ed" }],
} as const;

describe("embedCanvasIcons forms", () => {
	const both: CanvasIconAsset = { ...DOCKER, recipe: DOCKER_RECIPE };
	const icon = { slug: "docker", size: 28 };

	it("draws the hand-drawn recipe and embeds only it", () => {
		const result = embedCanvasIcons(canvas([node("a", { icon })]), () => both);
		expect(result.dropped).toEqual([]);
		expect(result.scene.icons).toEqual({ docker: { name: "Docker", recipe: DOCKER_RECIPE } });
	});

	it("embeds the exact SVG for an icon that asks, and both forms when the scene draws both", () => {
		const result = embedCanvasIcons(
			canvas([node("a", { icon: { ...icon, exact: true } }), node("b", { icon, y: 100 })]),
			() => both,
		);
		expect(result.scene.icons).toEqual({ docker: both });
	});

	it("draws every icon exact with exactIcons, marking each one", () => {
		const result = embedCanvasIcons(canvas([node("a", { icon })]), () => both, {
			exactIcons: true,
		});
		expect(result.scene.icons).toEqual({ docker: DOCKER });
		expect(result.scene.elements[0]).toMatchObject({ icon: { slug: "docker", exact: true } });
	});

	it("falls back to the other form, and drops an icon with neither or an undrawable recipe", () => {
		const exactWithoutSvg = embedCanvasIcons(
			canvas([node("a", { icon: { ...icon, exact: true } })]),
			() => ({
				name: "Docker",
				recipe: DOCKER_RECIPE,
			}),
		);
		expect(exactWithoutSvg.scene.icons).toEqual({
			docker: { name: "Docker", recipe: DOCKER_RECIPE },
		});

		const withoutRecipe = embedCanvasIcons(canvas([node("a", { icon })]), () => DOCKER);
		expect(withoutRecipe.scene.icons).toEqual({ docker: DOCKER });

		const broken = embedCanvasIcons(canvas([node("a", { icon })]), () => ({
			name: "Docker",
			recipe: { parts: [] },
		}));
		expect(broken.dropped).toEqual([
			{ elementId: "a", index: 0, reason: "unavailable", slug: "docker" },
		]);
	});
});

describe("embedCanvasIcons safety", () => {
	const prototypeSlugs = ["constructor", "__proto__", "toString", "hasOwnProperty"];

	it("never resolves prototype members as icon assets", () => {
		const result = embedCanvasIcons(
			canvas(prototypeSlugs.map((slug, index) => node(`n${index}`, { icon: { slug, size: 28 } }))),
			() => undefined,
		);

		expect(result.dropped.map(({ slug, reason }) => [slug, reason])).toEqual(
			prototypeSlugs.map((slug) => [slug, "unavailable"]),
		);
		expect(result.scene.icons).toBeUndefined();
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});

	it("embeds a real asset keyed by a prototype-member name as its own entry", () => {
		const result = embedCanvasIcons(
			canvas([node("a", { icon: { slug: "constructor", size: 28 } })]),
			(slug) => (slug === "constructor" ? DOCKER : undefined),
		);

		expect(Object.hasOwn(result.scene.icons ?? {}, "constructor")).toBe(true);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});

	it("flags prototype-member slugs without an own embedded asset", () => {
		for (const slug of prototypeSlugs) {
			const issues = getCanvasValidationIssues(
				canvas([node("a", { icon: { slug, size: 28 } })], { icons: {} }),
			);
			expect(issues, slug).toEqual([
				expect.objectContaining({ code: "invalid_icon", elementId: "a" }),
			]);
		}
	});

	it("drops icons that would push a label out of its node", () => {
		const icon = { slug: "docker", size: 28 };
		const result = embedCanvasIcons(
			canvas([
				// Fallback label: 16px text needs 40px alone and 76px under a logo.
				node("roomy", { height: 76, icon }),
				node("tight", { height: 60, icon }),
				node("already-overflowing", { height: 30, icon }),
			]),
			() => DOCKER,
		);

		expect(result.dropped).toEqual([
			{ elementId: "tight", index: 1, reason: "no_room", slug: "docker" },
		]);
		expect(
			result.scene.elements.map((element) =>
				element.type === "node" ? Boolean(element.icon) : undefined,
			),
		).toEqual([true, false, true]);
	});

	it("drops icons on sequence lifelines", () => {
		const result = embedCanvasIcons(
			canvas([
				node("line", {
					icon: { slug: "docker", size: 28 },
					rendererRole: "sequence-lifeline",
					width: 2,
					height: 200,
				}),
			]),
			() => DOCKER,
		);

		expect(result.dropped).toEqual([
			{ elementId: "line", index: 0, reason: "lifeline", slug: "docker" },
		]);
		expect(result.scene.icons).toBeUndefined();
	});

	it("keeps a group's logo on its frame or zone, whatever its name's length", () => {
		const icon = { slug: "docker", size: 18 };
		const zone = node("group:cloud", {
			icon,
			label: "A zone named at a length no header strip could hold beside a logo",
			rendererRole: "zone",
			width: 40,
			height: 40,
		});
		const frame: CanvasFrameElement = {
			type: "frame",
			id: "group:vercel",
			name: "Vercel",
			icon,
			x: 0,
			y: 0,
			width: 200,
			height: 100,
		};
		const result = embedCanvasIcons(canvas([zone, frame]), () => DOCKER);

		expect(result.dropped).toEqual([]);
		expect(result.scene.elements).toEqual([zone, frame]);
		expect(Object.keys(result.scene.icons ?? {})).toEqual(["docker"]);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
		expect(
			embedCanvasIcons(canvas([zone, frame]), () => undefined).dropped.map(
				(dropped) => dropped.reason,
			),
		).toEqual(["unavailable", "unavailable"]);
	});
});

describe("node icon validation", () => {
	it("requires an embedded asset, a valid slug and size, and no lifeline icons", () => {
		const issues = getCanvasValidationIssues(
			canvas(
				[
					node("missing", { icon: { slug: "github", size: 28 } }),
					node("bad-slug", { icon: { slug: "GitHub", size: 28 } }),
					node("tiny", { icon: { slug: "docker", size: 8 } }),
					node("line", {
						icon: { slug: "docker", size: 28 },
						label: "Line",
						rendererRole: "sequence-lifeline",
						width: 2,
						height: 200,
					}),
				],
				{ icons: { docker: DOCKER } },
			),
		);

		expect(issues).toEqual([
			expect.objectContaining({
				code: "invalid_icon",
				elementId: "missing",
				path: "elements[0].icon.slug",
			}),
			expect.objectContaining({
				code: "invalid_icon",
				elementId: "bad-slug",
				path: "elements[1].icon.slug",
			}),
			expect.objectContaining({
				code: "invalid_icon",
				elementId: "tiny",
				path: "elements[2].icon.size",
			}),
			expect.objectContaining({
				code: "invalid_icon",
				elementId: "line",
				path: "elements[3].icon",
			}),
		]);
	});

	it("limits embedded asset bytes", () => {
		expect(
			getCanvasValidationIssues(
				canvas([node("a")], {
					icons: {
						huge: {
							name: "Huge",
							svg: "x".repeat(CANVAS_NODE_ICON.maxAssetBytes + 1),
						},
					},
				}),
			),
		).toEqual([expect.objectContaining({ code: "limit_exceeded", path: "icons.huge.svg" })]);
	});

	it("requires a drawable recipe or an SVG for every embedded asset", () => {
		expect(
			getCanvasValidationIssues(
				canvas([node("a")], {
					icons: {
						empty: { name: "Empty" },
						broken: { name: "Broken", recipe: { parts: [] } },
						drawn: { name: "Drawn", recipe: DOCKER_RECIPE },
					},
				}),
			),
		).toEqual([
			expect.objectContaining({ code: "invalid_icon", path: "icons.empty" }),
			expect.objectContaining({ code: "invalid_icon", path: "icons.broken.recipe" }),
		]);
	});

	it("counts the icon band when checking whether a label fits", () => {
		const icon = { slug: "docker", size: 28 };
		// Fallback label: 16px text (22px tall) + 36px icon band inside the
		// rectangle's 10px-padded bound-text box.
		const fits = node("fits", { height: 68, icon });
		const overflows = node("overflows", { height: 67, icon });

		expect(getCanvasValidationIssues(canvas([fits], { icons: { docker: DOCKER } }))).toEqual([]);
		expect(getCanvasValidationIssues(canvas([overflows], { icons: { docker: DOCKER } }))).toEqual([
			expect.objectContaining({ code: "label_overflow" }),
		]);
		expect(getCanvasValidationIssues(canvas([node("plain", { height: 50 })]))).toEqual([]);
	});
});

describe("standalone icon elements", () => {
	function icon(id: string, overrides: Partial<CanvasIconElement> = {}): CanvasIconElement {
		return { type: "icon", id, slug: "docker", x: 10, y: 20, width: 48, height: 48, ...overrides };
	}

	it("draw their mark in the largest square centered in their box", () => {
		expect(canvasIconElementBox(icon("wide", { width: 160, height: 40 }))).toEqual({
			x: 70,
			y: 20,
			width: 40,
			height: 40,
		});
	});

	it("embed their mark, and tell assetFor they stand alone", () => {
		const asked: [string, boolean][] = [];
		const result = embedCanvasIcons(
			canvas([icon("a"), node("n", { icon: { slug: "docker", size: 28, exact: true } })]),
			(slug, standalone) => {
				asked.push([slug, standalone]);
				return DOCKER;
			},
		);
		expect(asked).toEqual([
			["docker", true],
			["docker", false],
		]);
		expect(result.scene.icons).toEqual({ docker: DOCKER });
		expect(result.dropped).toEqual([]);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});

	it("leave the scene whole, out of zOrder and layouts, when they cannot draw", () => {
		const result = embedCanvasIcons(
			canvas([icon("gone", { slug: "made-up" }), icon("kept"), node("n")], {
				layouts: [
					{ type: "row", ids: ["gone", "kept"] },
					{ type: "column", ids: ["gone"] },
				],
			}),
			(slug) => (slug === "docker" ? DOCKER : undefined),
		);
		expect(result.scene.elements.map((element) => element.id)).toEqual(["kept", "n"]);
		expect(result.scene.zOrder).toEqual(["kept", "n"]);
		expect(result.scene.layouts).toEqual([{ type: "row", ids: ["kept"] }]);
		expect(result.dropped).toEqual([
			{ elementId: "gone", index: 0, reason: "unavailable", slug: "made-up" },
		]);
	});

	it("validate their size and embedded asset", () => {
		const scene = canvas([icon("tiny", { width: CANVAS_ICON_ELEMENT.minSize - 1 }), icon("bare")], {
			icons: {},
		});
		expect(
			getCanvasValidationIssues(scene).map(({ code, elementId, path }) => [code, elementId, path]),
		).toEqual([
			["invalid_icon", "tiny", "elements[0].slug"],
			["invalid_icon", "tiny", "elements[0].width"],
			["invalid_icon", "bare", "elements[1].slug"],
		]);
	});
});

describe("drawn icons", () => {
	const RECIPE: IconRecipe = { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] };
	const DRAWN = drawnIconSlug(RECIPE);

	it("keep the recipe their scene carries; no other slug takes an authored asset", () => {
		const result = embedCanvasIcons(
			canvas(
				[
					node("a", { icon: { slug: DRAWN, size: 28 } }),
					node("b", { icon: { slug: "docker", size: 28 } }),
				],
				{
					icons: {
						[DRAWN]: { name: "Ring", recipe: RECIPE, svg: "<svg/>" },
						docker: { name: "Forged", recipe: RECIPE },
					},
				},
			),
			() => undefined,
		);
		expect(result.scene.icons).toEqual({ [DRAWN]: { name: "Ring", recipe: RECIPE } });
		expect(result.dropped).toEqual([
			{ elementId: "b", index: 1, reason: "unavailable", slug: "docker" },
		]);
	});

	it("drop a drawn slug whose carried recipe does not check", () => {
		const result = embedCanvasIcons(
			canvas([node("a", { icon: { slug: DRAWN, size: 28 } })], {
				icons: { [DRAWN]: { name: "Ring", recipe: { parts: [] } } },
			}),
			() => undefined,
		);
		expect(result.scene.icons).toBeUndefined();
		expect(result.dropped).toHaveLength(1);
	});
});
