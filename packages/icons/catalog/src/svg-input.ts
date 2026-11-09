import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Untrusted SVG made safe to rasterize: only drawing elements and presentation
 * attributes survive, references stay inside the document, and the root has an
 * explicit viewBox and intrinsic size. Brand colors come from the paint the
 * mark actually uses, not from guessing at pixels.
 */

export const SVG_INPUT_MAX_BYTES = 1024 * 1024;
export const SVG_INPUT_MAX_ELEMENTS = 20_000;

export interface SvgViewBox {
	readonly minX: number;
	readonly minY: number;
	readonly width: number;
	readonly height: number;
}

export interface SanitizedSvg {
	readonly svg: string;
	readonly viewBox: SvgViewBox;
	/** Distinct `#rrggbb` paints the drawing uses, the most used first. */
	readonly colors: readonly string[];
}

export type SvgInputIssue =
	| "svg_too_large"
	| "malformed_svg"
	| "not_svg"
	| "svg_without_size"
	| "svg_too_complex"
	| "empty_svg";

export type SanitizeSvgResult =
	| { readonly ok: true; readonly value: SanitizedSvg }
	| { readonly ok: false; readonly issue: SvgInputIssue; readonly message: string };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Elements that draw, group or define paint. Everything else goes, children included. */
const ALLOWED_ELEMENTS = new Set([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"defs",
	"linearGradient",
	"radialGradient",
	"stop",
	"clipPath",
	"mask",
	"pattern",
	"symbol",
	"use",
	"style",
	"text",
	"tspan",
	"image",
]);
/** Wrappers whose children still draw: a link around a mark, a conditional group. */
const UNWRAPPED_ELEMENTS = new Set(["a", "switch"]);
const DRAWN_ELEMENTS = new Set([
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"text",
	"tspan",
]);
/** Containers whose contents draw only where something references them. */
const REFERENCED_CONTAINERS = new Set([
	"defs",
	"clipPath",
	"mask",
	"pattern",
	"symbol",
	"linearGradient",
	"radialGradient",
]);

const ALLOWED_ATTRIBUTES = new Set([
	"id",
	"class",
	"style",
	"d",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"fx",
	"fy",
	"fr",
	"dx",
	"dy",
	"width",
	"height",
	"points",
	"viewBox",
	"preserveAspectRatio",
	"transform",
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-opacity",
	"opacity",
	"clip-path",
	"clip-rule",
	"mask",
	"offset",
	"stop-color",
	"stop-opacity",
	"gradientUnits",
	"gradientTransform",
	"spreadMethod",
	"patternUnits",
	"patternContentUnits",
	"patternTransform",
	"maskUnits",
	"maskContentUnits",
	"clipPathUnits",
	"display",
	"visibility",
	"color",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"text-anchor",
	"dominant-baseline",
	"letter-spacing",
	"textLength",
	"lengthAdjust",
	"paint-order",
	"vector-effect",
	"shape-rendering",
	"href",
	"xlink:href",
	"xml:space",
]);

const LOCAL_REFERENCE = /^#[\w.:-]+$/u;
const EMBEDDED_RASTER = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/iu;
const EXTERNAL_URL = /url\(\s*(?!['"]?#)[^)]*\)/giu;
const UNSAFE_CSS =
	/@import[^;]*;?|@font-face\s*\{[^}]*\}|expression\s*\(|behavior\s*:|-moz-binding/giu;

type XmlNode = Record<string, unknown>;

function attributesOf(node: XmlNode): Record<string, string> {
	const raw = node[":@"];
	if (typeof raw !== "object" || raw === null) return {};
	return Object.fromEntries(
		Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
	);
}

function tagOf(node: XmlNode): string | undefined {
	return Object.keys(node).find((key) => key !== ":@");
}

function childrenOf(node: XmlNode, tag: string): XmlNode[] {
	const children = node[tag];
	return Array.isArray(children) ? (children as XmlNode[]) : [];
}

function safeCss(value: string): string {
	return value.replace(UNSAFE_CSS, "").replace(EXTERNAL_URL, "none");
}

function safeAttributes(tag: string, attributes: Record<string, string>): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [name, value] of Object.entries(attributes)) {
		if (!ALLOWED_ATTRIBUTES.has(name)) continue;
		if (name === "href" || name === "xlink:href") {
			const target = value.trim();
			if (LOCAL_REFERENCE.test(target) || (tag === "image" && EMBEDDED_RASTER.test(target))) {
				kept["href"] = target;
			}
			continue;
		}
		const cleaned = name === "style" ? safeCss(value) : value.replace(EXTERNAL_URL, "none");
		if (cleaned.trim()) kept[name] = cleaned;
	}
	return kept;
}

interface SanitizeState {
	elements: number;
}

function sanitizeChildren(nodes: readonly XmlNode[], state: SanitizeState): XmlNode[] {
	const kept: XmlNode[] = [];
	for (const node of nodes) {
		const tag = tagOf(node);
		if (tag === undefined) continue;
		if (tag === "#text") {
			kept.push({ "#text": node["#text"] });
			continue;
		}
		if (tag.startsWith("?") || tag.startsWith("!") || tag === "#comment") continue;
		if (UNWRAPPED_ELEMENTS.has(tag)) {
			kept.push(...sanitizeChildren(childrenOf(node, tag), state));
			continue;
		}
		if (!ALLOWED_ELEMENTS.has(tag)) continue;
		state.elements += 1;
		if (state.elements > SVG_INPUT_MAX_ELEMENTS) return kept;
		const attributes = safeAttributes(tag, attributesOf(node));
		if (tag === "image" && attributes["href"] === undefined) continue;
		const children =
			tag === "style"
				? childrenOf(node, tag).flatMap((child) =>
						typeof child["#text"] === "string" || typeof child["#text"] === "number"
							? [{ "#text": safeCss(String(child["#text"])) }]
							: [],
					)
				: sanitizeChildren(childrenOf(node, tag), state);
		kept.push({
			[tag]: children,
			...(Object.keys(attributes).length > 0 ? { ":@": attributes } : {}),
		});
	}
	return kept;
}

function parseNumbers(value: string | undefined): number[] {
	return (value ?? "")
		.trim()
		.split(/[\s,]+/u)
		.filter(Boolean)
		.map(Number);
}

function lengthOf(value: string | undefined): number | undefined {
	const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/u.exec(value ?? "");
	return match ? Number(match[1]) : undefined;
}

function rootViewBox(attributes: Record<string, string>): SvgViewBox | undefined {
	const values = parseNumbers(attributes["viewBox"]);
	if (
		values.length === 4 &&
		values.every((value) => Number.isFinite(value)) &&
		(values[2] ?? 0) > 0 &&
		(values[3] ?? 0) > 0
	) {
		const [minX = 0, minY = 0, width = 0, height = 0] = values;
		return { minX, minY, width, height };
	}
	const width = lengthOf(attributes["width"]);
	const height = lengthOf(attributes["height"]);
	return width && height ? { minX: 0, minY: 0, width, height } : undefined;
}

/** Sanitize untrusted SVG markup into a self-contained drawing. */
export function sanitizeSvg(source: string): SanitizeSvgResult {
	if (new TextEncoder().encode(source).byteLength > SVG_INPUT_MAX_BYTES) {
		return {
			ok: false,
			issue: "svg_too_large",
			message: `The SVG exceeds ${SVG_INPUT_MAX_BYTES / 1024} KB.`,
		};
	}
	if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
		return {
			ok: false,
			issue: "malformed_svg",
			message: "The SVG declares a DOCTYPE or entities, which are not accepted.",
		};
	}
	if (XMLValidator.validate(source) !== true) {
		return { ok: false, issue: "malformed_svg", message: "The SVG is not well-formed XML." };
	}
	const parser = new XMLParser({
		preserveOrder: true,
		ignoreAttributes: false,
		attributeNamePrefix: "",
		trimValues: false,
		processEntities: false,
		removeNSPrefix: false,
	});
	const parsed: unknown = parser.parse(source);
	const nodes = Array.isArray(parsed) ? (parsed as XmlNode[]) : [];
	const root = nodes.find((node) => tagOf(node) === "svg");
	if (!root) {
		return { ok: false, issue: "not_svg", message: "The file has no <svg> root element." };
	}
	const rootAttributes = attributesOf(root);
	const viewBox = rootViewBox(rootAttributes);
	if (!viewBox) {
		return {
			ok: false,
			issue: "svg_without_size",
			message: "The SVG has neither a viewBox nor a numeric width and height.",
		};
	}
	const state: SanitizeState = { elements: 0 };
	const children = sanitizeChildren(childrenOf(root, "svg"), state);
	if (state.elements > SVG_INPUT_MAX_ELEMENTS) {
		return {
			ok: false,
			issue: "svg_too_complex",
			message: `The SVG has more than ${SVG_INPUT_MAX_ELEMENTS} elements.`,
		};
	}
	const {
		viewBox: _viewBox,
		width: _width,
		height: _height,
		...rest
	} = safeAttributes("svg", rootAttributes);
	const tree: XmlNode = {
		svg: children,
		":@": {
			xmlns: SVG_NAMESPACE,
			"xmlns:xlink": XLINK_NAMESPACE,
			...rest,
			viewBox: `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`,
			width: String(viewBox.width),
			height: String(viewBox.height),
		},
	};
	const colors = svgPaintColors(tree);
	if (!hasDrawing(children)) {
		return { ok: false, issue: "empty_svg", message: "The SVG draws nothing." };
	}
	const builder = new XMLBuilder({
		preserveOrder: true,
		ignoreAttributes: false,
		attributeNamePrefix: "",
		suppressEmptyNode: true,
		processEntities: false,
	});
	return { ok: true, value: { svg: builder.build([tree]), viewBox, colors } };
}

function hasDrawing(nodes: readonly XmlNode[]): boolean {
	return nodes.some((node) => {
		const tag = tagOf(node);
		if (tag === undefined || tag === "#text" || REFERENCED_CONTAINERS.has(tag)) return false;
		return (
			DRAWN_ELEMENTS.has(tag) ||
			tag === "use" ||
			tag === "image" ||
			hasDrawing(childrenOf(node, tag))
		);
	});
}

// ---------------------------------------------------------------------------
// Paint colors

const NAMED_COLORS: Readonly<Record<string, string>> = {
	black: "#000000",
	white: "#ffffff",
	red: "#ff0000",
	green: "#008000",
	lime: "#00ff00",
	blue: "#0000ff",
	yellow: "#ffff00",
	orange: "#ffa500",
	purple: "#800080",
	gray: "#808080",
	grey: "#808080",
	navy: "#000080",
	teal: "#008080",
	silver: "#c0c0c0",
	maroon: "#800000",
	fuchsia: "#ff00ff",
	aqua: "#00ffff",
};

function hex2(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value)))
		.toString(16)
		.padStart(2, "0");
}

/** A CSS color as lowercase `#rrggbb`, or undefined for none, a reference or anything unknown. */
export function normalizeCssColor(value: string | undefined): string | undefined {
	const color = value
		?.trim()
		.toLowerCase()
		.replace(/\s*!important$/u, "");
	if (!color || color === "none" || color === "transparent") return undefined;
	if (color === "currentcolor") return "#000000";
	const named = NAMED_COLORS[color];
	if (named) return named;
	const hex = /^#([0-9a-f]{3,8})$/u.exec(color)?.[1];
	if (hex && [3, 4, 6, 8].includes(hex.length)) {
		const full =
			hex.length <= 4
				? [...hex.slice(0, 3)].map((digit) => digit + digit).join("")
				: hex.slice(0, 6);
		return `#${full}`;
	}
	const rgb = /^rgba?\(([^)]*)\)$/u.exec(color)?.[1];
	if (rgb) {
		const channels = rgb
			.split(/[\s,/]+/u)
			.filter(Boolean)
			.slice(0, 3)
			.map((channel) =>
				channel.endsWith("%")
					? (Number.parseFloat(channel) / 100) * 255
					: Number.parseFloat(channel),
			);
		if (channels.length === 3 && channels.every((channel) => Number.isFinite(channel))) {
			return `#${channels.map(hex2).join("")}`;
		}
	}
	return undefined;
}

function declarations(style: string | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	for (const declaration of (style ?? "").split(";")) {
		const colon = declaration.indexOf(":");
		if (colon <= 0) continue;
		result[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
	}
	return result;
}

function cssRules(tree: XmlNode): Map<string, Record<string, string>> {
	const rules = new Map<string, Record<string, string>>();
	const visit = (node: XmlNode) => {
		const tag = tagOf(node);
		if (tag === undefined || tag === "#text") return;
		if (tag === "style") {
			const text = childrenOf(node, tag)
				.map((child) => {
					const text = child["#text"];
					return typeof text === "string" || typeof text === "number" ? String(text) : "";
				})
				.join("");
			for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
				const body = declarations(match[2]);
				for (const selector of (match[1] ?? "").split(",")) {
					const key = selector.trim();
					if (key) rules.set(key, { ...rules.get(key), ...body });
				}
			}
			return;
		}
		childrenOf(node, tag).forEach(visit);
	};
	visit(tree);
	return rules;
}

interface Paint {
	readonly fill: string | undefined;
	readonly stroke: string | undefined;
}

/**
 * The colors a drawing paints with, counted once per drawn element: the fill
 * a shape inherits (black when nothing sets one), its stroke, and the stops
 * of any gradient it references.
 */
function svgPaintColors(tree: XmlNode): string[] {
	const rules = cssRules(tree);
	const gradients = new Map<string, string[]>();
	const collectGradients = (node: XmlNode) => {
		const tag = tagOf(node);
		if (tag === undefined || tag === "#text") return;
		if (tag === "linearGradient" || tag === "radialGradient") {
			const id = attributesOf(node)["id"];
			const stops = childrenOf(node, tag).flatMap((stop) => {
				const attributes = attributesOf(stop);
				const color = normalizeCssColor(
					declarations(attributes["style"])["stop-color"] ?? attributes["stop-color"],
				);
				return color ? [color] : [];
			});
			if (id) gradients.set(id, stops);
		}
		childrenOf(node, tag).forEach(collectGradients);
	};
	collectGradients(tree);

	const counts = new Map<string, number>();
	const count = (value: string | undefined) => {
		if (!value) return;
		const reference = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/u.exec(value.trim())?.[1];
		const colors = reference ? (gradients.get(reference) ?? []) : [normalizeCssColor(value)];
		for (const color of colors) {
			if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
		}
	};
	const visit = (node: XmlNode, inherited: Paint) => {
		const tag = tagOf(node);
		if (tag === undefined || tag === "#text" || REFERENCED_CONTAINERS.has(tag) || tag === "style") {
			return;
		}
		const attributes = attributesOf(node);
		const classRules = (attributes["class"] ?? "")
			.split(/\s+/u)
			.filter(Boolean)
			.map((name) => rules.get(`.${name}`) ?? {});
		const element = Object.assign(
			{},
			rules.get(tag) ?? {},
			...classRules,
			declarations(attributes["style"]),
		);
		const paint: Paint = {
			fill: element["fill"] ?? attributes["fill"] ?? inherited.fill,
			stroke: element["stroke"] ?? attributes["stroke"] ?? inherited.stroke,
		};
		if (DRAWN_ELEMENTS.has(tag) && tag !== "tspan") {
			if (tag !== "line" && tag !== "polyline") count(paint.fill ?? "#000000");
			count(paint.stroke);
		}
		childrenOf(node, tag).forEach((child) => visit(child, paint));
	};
	visit(tree, { fill: undefined, stroke: undefined });
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([color]) => color);
}
