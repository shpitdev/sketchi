import {
	CANVAS_SPEC_VERSION,
	canvasBoundTextBox,
	canvasFrameNameBox,
	estimateTextWidth,
	isWireframeContainer,
	orgPersonInitials,
	SKETCHI_DIAGRAM_PALETTE,
	validateWireframeDiagram,
	WIREFRAME_DEFAULT_TABLE_ROWS,
	WIREFRAME_DEFAULT_TEXT_LINES,
	type WireframeAlignment,
	type WireframeComponent,
	type WireframeComponentType,
	type WireframeDevice,
	type WireframeDiagram,
	type WireframeScreen,
	wrapTextToWidth,
} from "@sketchi/diagram-core";

import { routeNavigations, type NavigationBox } from "./wireframe-navigation.js";
import type {
	ArrowSceneElement,
	FrameSceneElement,
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

/** Every gap between siblings, and every container's padding, comes from this scale. */
export const WIREFRAME_SPACING = [4, 8, 12, 16, 24, 32] as const;

interface DeviceMetrics {
	readonly width: number;
	/** A screen grows past this with its content, never below it. */
	readonly minHeight: number;
	/** Padding around the content area. */
	readonly pad: number;
	/** Between blocks of the content area. */
	readonly gap: number;
	readonly rowGap: number;
	readonly gridGap: number;
	/** Between the items of a header or footer. */
	readonly barGap: number;
	readonly barHeight: number;
	/** Height of a button, input, select or search bar. */
	readonly control: number;
	/** The least height of anything a finger or pointer hits: 44 on a phone. */
	readonly touch: number;
	/** A sidebar's width; on a phone a sidebar stacks into the content instead. */
	readonly sidebar: number;
	readonly modal: number;
	/** Heading sizes for levels 1, 2 and 3. */
	readonly headings: readonly [number, number, number];
}

export const WIREFRAME_DEVICE_METRICS: Readonly<Record<WireframeDevice, DeviceMetrics>> = {
	desktop: {
		width: 1280,
		minHeight: 800,
		pad: 32,
		gap: 24,
		rowGap: 16,
		gridGap: 24,
		barGap: 24,
		barHeight: 64,
		control: 40,
		touch: 24,
		sidebar: 240,
		modal: 480,
		headings: [28, 22, 18],
	},
	tablet: {
		width: 768,
		minHeight: 1024,
		pad: 24,
		gap: 16,
		rowGap: 12,
		gridGap: 16,
		barGap: 16,
		barHeight: 56,
		control: 40,
		touch: 32,
		sidebar: 200,
		modal: 440,
		headings: [26, 20, 18],
	},
	mobile: {
		width: 390,
		minHeight: 844,
		pad: 16,
		gap: 16,
		rowGap: 12,
		gridGap: 12,
		barGap: 12,
		barHeight: 56,
		control: 44,
		touch: 44,
		sidebar: 0,
		modal: 358,
		headings: [24, 20, 17],
	},
};

const LINE_HEIGHT = 1.25;
const BODY = 14;
const LABEL = 13;
const SMALL = 12;
const CARD_TITLE = 15;
const CARD_PAD = 16;
const MODAL_PAD = 24;
const STACK_GAP = 12;
/** Paragraph lines stop at a readable measure. */
const MEASURE = 640;
const PLACEHOLDER_MEASURE = 560;
const PLACEHOLDER_PITCH = 20;
const FIELD_PAD = 12;
const LABEL_GAP = 6;
const BOX = 18;
const TRACK_WIDTH = 36;
const TRACK_HEIGHT = 20;
const KNOB = 14;
const AVATAR = 40;
const ICON = 22;
const BADGE_HEIGHT = 22;
const BULLET = 6;
const TAB_PAD = 12;
const SCREEN_GAP_X = 80;
const SCREEN_GAP_Y = 96;
const PADDING = 40;
/** Wider than this, a sheet of screens wraps onto another row. */
const MAX_ASPECT = 2.45;

const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const TEXT = "#495057";
const MUTED = "#868e96";
const STROKE = "#495057";
const LINE = "#adb5bd";
const PLACEHOLDER = "#ced4da";
const FILL = "#f1f3f5";
const FILL_DARK = "#e9ecef";
const WHITE = "#ffffff";
/** The one accent: primary actions, links, and what is selected or on. */
export const WIREFRAME_ACCENT = "#1971c2";
const ACCENT_TINT = "#e7f5ff";
const SCRIM = "#343a40";

const WIDGET = "wireframe-widget" as const;
const REGION = "wireframe-region" as const;

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

interface Measure {
	/** The narrowest width at which nothing overflows. */
	readonly min: number;
	/** The width it takes when it hugs its content. */
	readonly pref: number;
	/** Whether it fills the width a column or row leaves it. */
	readonly grow: boolean;
	/** The widest it stretches down a column; a settings row stays readable. */
	readonly max?: number;
}

/** The width a column gives a child: fields fill it unless the column centers or ends them. */
function columnWidth(size: Measure, width: number, align: WireframeAlignment): number {
	const fills = (align === "start" || align === "between") && size.grow;
	return Math.max(
		size.min,
		fills ? Math.min(width, size.max ?? width) : Math.min(width, size.pref),
	);
}

type TextAlign = "left" | "center";

interface Context {
	readonly device: DeviceMetrics;
	readonly mobile: boolean;
	readonly inSidebar: boolean;
	/** The level an unleveled heading takes here. */
	readonly headingLevel: 1 | 2 | 3;
	readonly textAlign: TextAlign;
}

/** Where each element of a component goes: its groups and its screen's frame. */
interface Scope {
	readonly groupIds: string[];
	readonly frameId: string;
	readonly opacity?: number;
}

/** How a container arranges its children, for the spacing invariant. */
export interface WireframeFlow {
	readonly axis: "column" | "row" | "grid";
	readonly gap: number;
	/** The free space of a row spread between its children, so gaps vary. */
	readonly spread: boolean;
}

/** A component placed: its box, relative to its parent until the screen is placed. */
interface Laid {
	readonly component: WireframeComponent;
	readonly path: string;
	width: number;
	height: number;
	x: number;
	y: number;
	readonly children: Laid[];
	readonly flow?: WireframeFlow;
	/** A card or section fills the height of its row or grid line. */
	readonly stretch: boolean;
	/** Children placed over the rest: a screen's modals. */
	readonly overlay?: boolean;
	/** The height a titled container's title takes, so titles side by side can share one. */
	readonly titleHeight?: number;
	readonly paint: (box: Box, scope: Scope, id: string) => SceneElement[];
}

interface Wrapped {
	readonly text: string;
	readonly width: number;
	readonly height: number;
	readonly lines: number;
}

const textHeight = (lines: number, fontSize: number) => Math.ceil(lines * fontSize * LINE_HEIGHT);

function wrap(text: string, maxWidth: number, fontSize: number): Wrapped {
	const wrapped = wrapTextToWidth(text, Math.max(1, Math.floor(maxWidth)), fontSize);
	const lines = wrapped.split("\n").length;
	return {
		text: wrapped,
		width: Math.ceil(estimateTextWidth(wrapped, fontSize)),
		height: textHeight(lines, fontSize),
		lines,
	};
}

/** The widest word, which no wrap can break. */
function longestWord(text: string | undefined, fontSize: number): number {
	if (!text) return 0;
	return Math.ceil(
		Math.max(0, ...text.split(/\s+/u).map((word) => estimateTextWidth(word, fontSize))),
	);
}

/**
 * Excalifont's painted advance, narrower than the layout estimate, which errs
 * wide: a link's underline stops where its glyphs do.
 */
function paintedWidth(text: string, fontSize: number): number {
	let units = 0;
	for (const char of text)
		units += /\p{Lu}/u.test(char)
			? 0.66
			: /[\p{Ll}\p{N}]/u.test(char)
				? 0.54
				: char === " "
					? 0.3
					: 0.42;
	return Math.min(Math.ceil(estimateTextWidth(text, fontSize)), Math.ceil(units * fontSize));
}

const lineWidth = (text: string | undefined, fontSize: number) =>
	text ? Math.ceil(estimateTextWidth(text, fontSize)) : 0;

/** Free text at the top left of `box`, or centered across it. */
function freeText(
	id: string,
	wrapped: Wrapped,
	fontSize: number,
	box: { readonly x: number; readonly y: number; readonly width: number },
	align: TextAlign,
	color: string,
	scope: Scope,
): TextSceneElement {
	return {
		type: "text",
		id,
		x: align === "left" ? box.x + wrapped.width / 2 : box.x + box.width / 2,
		y: box.y + wrapped.height / 2,
		text: wrapped.text,
		fontSize,
		lineHeight: LINE_HEIGHT,
		maxWidth: wrapped.width,
		textAlign: align,
		textColor: color,
		...scope,
	};
}

function shape(
	id: string,
	kind: string,
	box: Box,
	role: typeof WIDGET | typeof REGION,
	style: { fill: string; stroke: string; shape?: "rectangle" | "ellipse"; strokeWidth?: 1 | 2 | 4 },
	label: string,
	scope: Scope,
): NodeSceneElement {
	return {
		type: "node",
		id,
		nodeId: id,
		kind: `wireframe:${kind}`,
		shape: style.shape ?? "rectangle",
		rendererRole: role,
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		label,
		fillColor: style.fill,
		fillStyle: "solid",
		strokeColor: style.stroke,
		strokeWidth: style.strokeWidth ?? 1,
		...scope,
	};
}

function line(
	id: string,
	points: readonly ScenePoint[],
	color: string,
	strokeWidth: 1 | 2 | 4,
	scope: Scope,
): LineSceneElement {
	return {
		type: "line",
		id,
		points: points.map((point) => ({
			x: Math.round(point.x * 100) / 100,
			y: Math.round(point.y * 100) / 100,
		})) as [ScenePoint, ScenePoint, ...ScenePoint[]],
		strokeColor: color,
		strokeWidth,
		...scope,
	};
}

/** A button's or avatar's label, bound to it and centered as Excalidraw centers it. */
function boundText(
	id: string,
	container: NodeSceneElement,
	text: string,
	fontSize: number,
	maxWidth: number,
	color: string,
	scope: Scope,
): TextSceneElement {
	return {
		type: "text",
		id,
		containerId: container.id,
		x: container.x + container.width / 2,
		y: container.y + container.height / 2,
		text,
		fontSize,
		lineHeight: LINE_HEIGHT,
		maxWidth: Math.max(1, Math.floor(maxWidth)),
		textColor: color,
		...scope,
	};
}

/** Interactive components keep a touch target's height on a phone. */
const INTERACTIVE: ReadonlySet<string> = new Set([
	"button",
	"link",
	"input",
	"textarea",
	"select",
	"checkbox",
	"radio",
	"toggle",
	"search",
	"tabs",
	"nav",
	"icon",
]);

export function isWireframeInteractive(type: WireframeComponentType): boolean {
	return INTERACTIVE.has(type);
}

/** Containers drawn with an outline or band, which group everything inside them. */
const GROUPING: ReadonlySet<string> = new Set([
	"header",
	"footer",
	"sidebar",
	"section",
	"card",
	"modal",
]);

function headingSize(component: WireframeComponent, context: Context): number {
	const level = (component.level ?? context.headingLevel) as 1 | 2 | 3;
	return context.device.headings[level - 1]!;
}

/** Headings and titles step down to these sizes before a word too long for them would overflow. */
const HEADING_FLOOR = 16;
const TITLE_FLOOR = 13;

/** The largest size from `size` down to `floor` at which every word of `text` fits `width`. */
function fitSize(text: string | undefined, size: number, width: number, floor: number): number {
	let fit = size;
	while (fit > floor && longestWord(text, fit) > width) fit -= 1;
	return fit;
}

function childContext(component: WireframeComponent, context: Context): Context {
	const type = component.type;
	const headingLevel =
		type === "header" || type === "footer" || type === "sidebar"
			? 3
			: type === "card" || type === "modal" || type === "section"
				? 2
				: context.headingLevel;
	const align = component.align ?? (type === "header" || type === "footer" ? "between" : "start");
	return {
		...context,
		inSidebar: context.inSidebar || type === "sidebar",
		headingLevel: Math.max(context.headingLevel, headingLevel) as 1 | 2 | 3,
		textAlign:
			type === "row" || type === "header" || type === "footer" || type === "grid"
				? "left"
				: align === "center"
					? "center"
					: "left",
	};
}

const ROWS: ReadonlySet<string> = new Set(["row", "header", "footer"]);

function containerTitleSize(type: WireframeComponentType, context: Context): number {
	if (type === "main") return context.device.headings[0];
	if (type === "section" || type === "modal" || type === "sidebar" || type === "header")
		return context.device.headings[2];
	return CARD_TITLE;
}

/** The padding inside a container, on each side. */
function containerPad(type: WireframeComponentType, context: Context): { x: number; y: number } {
	if (type === "card") return { x: CARD_PAD, y: CARD_PAD };
	if (type === "modal") return { x: MODAL_PAD, y: MODAL_PAD };
	if (type === "sidebar") return { x: CARD_PAD, y: CARD_PAD };
	if (type === "header" || type === "footer") return { x: context.device.pad, y: 12 };
	return { x: 0, y: 0 };
}

function containerGap(type: WireframeComponentType, context: Context): number {
	if (type === "header" || type === "footer") return context.device.barGap;
	if (type === "row") return context.device.rowGap;
	if (type === "grid") return context.device.gridGap;
	if (type === "main") return context.device.gap;
	return STACK_GAP;
}

// ---------------------------------------------------------------- measure

function measure(component: WireframeComponent, context: Context): Measure {
	const { device } = context;
	const touch = device.touch;
	switch (component.type) {
		case "heading": {
			const size = headingSize(component, context);
			return {
				min: longestWord(component.text, Math.min(size, HEADING_FLOOR)),
				pref: lineWidth(component.text, size),
				grow: true,
			};
		}
		case "text":
			return component.text
				? {
						min: longestWord(component.text, BODY),
						pref: Math.min(MEASURE, lineWidth(component.text, BODY)),
						grow: true,
					}
				: { min: 80, pref: 320, grow: true };
		case "link":
			return {
				min: longestWord(component.text, BODY),
				pref: lineWidth(component.text, BODY),
				grow: false,
			};
		case "badge":
			return {
				min: longestWord(component.text, SMALL) + 16,
				pref: lineWidth(component.text, SMALL) + 16,
				grow: false,
			};
		case "button":
			return {
				min: Math.max(48, longestWord(component.text, BODY) + 32),
				pref: Math.max(80, lineWidth(component.text, BODY) + 32),
				grow: false,
			};
		case "input":
		case "textarea":
		case "select":
		case "search": {
			const inner =
				component.value ?? component.placeholder ?? (component.type === "search" ? "Search" : "");
			const trailing = component.type === "select" || component.type === "search" ? 36 : 0;
			const min = Math.max(
				component.type === "search" ? 140 : 120,
				longestWord(component.label, LABEL),
				longestWord(inner, BODY) + 2 * FIELD_PAD + trailing,
			);
			const pref = Math.max(
				min,
				component.type === "search" ? 280 : 320,
				Math.min(480, lineWidth(inner, BODY) + 2 * FIELD_PAD + trailing),
			);
			return { min, pref, grow: true };
		}
		case "checkbox":
		case "radio":
			return {
				min: BOX + 8 + longestWord(component.label, BODY),
				pref: BOX + 8 + lineWidth(component.label, BODY),
				grow: false,
			};
		case "toggle":
			return {
				min: longestWord(component.label, BODY) + 16 + TRACK_WIDTH,
				pref: lineWidth(component.label, BODY) + 16 + TRACK_WIDTH,
				grow: true,
				max: MEASURE,
			};
		case "tabs": {
			// An item wraps at whole words, so its longest word is all it needs.
			const items = component.items ?? [];
			const widths = items.map((item) => lineWidth(item, BODY) + 2 * TAB_PAD);
			return {
				min: Math.max(0, ...items.map((item) => longestWord(item, BODY) + 2 * TAB_PAD)),
				pref: widths.reduce((sum, width) => sum + width, 0) + 4 * Math.max(0, widths.length - 1),
				grow: true,
			};
		}
		case "nav": {
			const items = component.items ?? [];
			const widths = items.map((item) => lineWidth(item, BODY) + 2 * TAB_PAD);
			const min = Math.max(0, ...items.map((item) => longestWord(item, BODY) + 2 * TAB_PAD));
			return context.inSidebar
				? { min, pref: Math.max(0, ...widths), grow: true }
				: {
						min,
						pref:
							widths.reduce((sum, width) => sum + width, 0) + 4 * Math.max(0, widths.length - 1),
						grow: false,
					};
		}
		case "breadcrumbs": {
			const text = breadcrumbText(component);
			return { min: longestWord(text, LABEL), pref: lineWidth(text, LABEL), grow: false };
		}
		case "avatar": {
			const size = context.mobile ? Math.max(AVATAR, touch) : AVATAR;
			return { min: size, pref: size, grow: false };
		}
		case "icon": {
			const glyph = Math.max(ICON, context.mobile ? touch : ICON);
			return {
				min: glyph + (component.label ? 8 + longestWord(component.label, BODY) : 0),
				pref: glyph + (component.label ? 8 + lineWidth(component.label, BODY) : 0),
				grow: false,
			};
		}
		case "image":
			return { min: Math.max(48, longestWord(component.label, LABEL) + 24), pref: 320, grow: true };
		case "chart":
			return {
				min: Math.max(160, longestWord(component.label, LABEL) + 24),
				pref: 360,
				grow: true,
			};
		case "table": {
			const headers = tableHeaders(component);
			const stacked =
				Math.max(...headers.map((header) => longestWord(header, LABEL))) + 3 * FIELD_PAD + 48;
			const pref = headers.reduce(
				(sum, header) => sum + lineWidth(header, LABEL) + 2 * FIELD_PAD + 32,
				0,
			);
			return { min: stacked, pref: Math.max(stacked, pref), grow: true };
		}
		case "list": {
			const items = component.items ?? [];
			return {
				min: BULLET + 12 + Math.max(0, ...items.map((item) => longestWord(item, BODY))),
				pref: BULLET + 12 + Math.max(0, ...items.map((item) => lineWidth(item, BODY))),
				grow: true,
			};
		}
		case "divider":
			return { min: 1, pref: 1, grow: true };
		default:
			return measureContainer(component, context);
	}
}

function measureContainer(component: WireframeComponent, context: Context): Measure {
	const type = component.type;
	const inner = childContext(component, context);
	const pad = containerPad(type, context);
	const gap = containerGap(type, context);
	const children = (component.children ?? []).map((child) => measure(child, inner));
	const titleSize = containerTitleSize(type, context);
	const title = component.title;
	const titleMin =
		longestWord(title, Math.min(titleSize, TITLE_FLOOR)) + (type === "modal" ? 32 : 0);
	const titlePref = lineWidth(title, titleSize);
	const widestMin = Math.max(0, titleMin, ...children.map((child) => child.min));
	if (type === "sidebar" && !context.mobile) {
		const width = Math.max(context.device.sidebar, widestMin + 2 * pad.x);
		return { min: width, pref: width, grow: false };
	}
	if (type === "modal") {
		// A dialog keeps its device's width where it has room; nested in a narrow column it narrows.
		const min = widestMin + 2 * pad.x;
		return {
			min,
			pref: Math.max(
				min,
				Math.min(context.device.modal, context.device.width - 2 * context.device.pad),
			),
			grow: false,
		};
	}
	if (ROWS.has(type)) {
		// A row wraps, so its narrowest is its widest child. Its title leads it as the heading it draws.
		const items = [
			...(title ? [measure({ type: "heading", text: title }, inner)] : []),
			...children,
		];
		return {
			min: Math.max(0, ...items.map((child) => child.min)) + 2 * pad.x,
			pref:
				items.reduce((sum, child) => sum + child.pref, 0) +
				gap * Math.max(0, items.length - 1) +
				2 * pad.x,
			grow: true,
		};
	}
	if (type === "grid") {
		const columns = Math.max(
			1,
			Math.min(typeof component.columns === "number" ? component.columns : 1, children.length || 1),
		);
		const widestPref = Math.max(0, ...children.map((child) => child.pref));
		return {
			min: widestMin,
			pref: Math.max(titlePref, columns * widestPref + gap * (columns - 1)),
			grow: true,
		};
	}
	return {
		min: widestMin + 2 * pad.x,
		pref: Math.max(titlePref, ...children.map((child) => child.pref)) + 2 * pad.x,
		grow: true,
	};
}

function breadcrumbText(component: WireframeComponent): string {
	return (component.items ?? []).join("  ›  ");
}

function tableHeaders(component: WireframeComponent): readonly string[] {
	return Array.isArray(component.columns) ? component.columns : [];
}

// ----------------------------------------------------------------- layout

function leaf(
	component: WireframeComponent,
	path: string,
	width: number,
	height: number,
	paint: Laid["paint"],
): Laid {
	return { component, path, width, height, x: 0, y: 0, children: [], stretch: false, paint };
}

/** Lay a component out at `width`, which is never below its min. */
function layout(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
	titleHeight?: number,
): Laid {
	const { device } = context;
	const touch = device.touch;
	const align = context.textAlign;
	switch (component.type) {
		case "heading": {
			const size = fitSize(component.text, headingSize(component, context), width, HEADING_FLOOR);
			const text = wrap(component.text ?? "", width, size);
			return leaf(component, path, width, text.height, (box, scope, id) => [
				freeText(`${id}:text`, text, size, box, align, INK, scope),
			]);
		}
		case "text": {
			if (component.text) {
				const text = wrap(component.text, Math.min(width, MEASURE), BODY);
				return leaf(component, path, width, text.height, (box, scope, id) => [
					freeText(`${id}:text`, text, BODY, box, align, TEXT, scope),
				]);
			}
			const lines = component.lines ?? WIREFRAME_DEFAULT_TEXT_LINES;
			return leaf(component, path, width, lines * PLACEHOLDER_PITCH, (box, scope, id) => {
				const span = Math.min(box.width, PLACEHOLDER_MEASURE);
				const left = align === "center" ? box.x + (box.width - span) / 2 : box.x;
				return Array.from({ length: lines }, (_, index) => {
					const share =
						index === lines - 1 && lines > 1
							? 0.6
							: [1, 0.94, 0.97, 0.9, 0.96, 0.92, 0.98][index % 7]!;
					const length = Math.max(8, Math.round(span * share));
					const start = align === "center" ? left + (span - length) / 2 : left;
					const y = box.y + PLACEHOLDER_PITCH * index + PLACEHOLDER_PITCH / 2;
					return line(
						`${id}:line-${index}`,
						[
							{ x: start + 2, y },
							{ x: start + length - 2, y },
						],
						PLACEHOLDER,
						4,
						scope,
					);
				});
			});
		}
		case "link": {
			const text = wrap(component.text ?? "", width, BODY);
			const height = Math.max(text.height + 3, context.mobile ? touch : 0);
			const color = component.disabled ? MUTED : WIREFRAME_ACCENT;
			return leaf(
				component,
				path,
				Math.min(width, Math.max(text.width, context.mobile ? touch : 0)),
				height,
				(box, scope, id) => {
					const top = box.y + Math.round((box.height - text.height - 3) / 2);
					const left = align === "center" ? box.x + (box.width - text.width) / 2 : box.x;
					const lastLine = text.text.split("\n").at(-1) ?? "";
					const underline = paintedWidth(lastLine, BODY);
					const underlineLeft = align === "center" ? box.x + (box.width - underline) / 2 : left;
					return [
						freeText(
							`${id}:text`,
							text,
							BODY,
							{ x: box.x, y: top, width: box.width },
							align,
							color,
							scope,
						),
						line(
							`${id}:underline`,
							[
								{ x: underlineLeft, y: top + text.height + 2 },
								{ x: underlineLeft + underline, y: top + text.height + 2 },
							],
							color,
							1,
							scope,
						),
					];
				},
			);
		}
		case "badge": {
			const text = wrap(component.text ?? "", width - 16, SMALL);
			const height = Math.max(BADGE_HEIGHT, text.height + 8);
			return leaf(component, path, Math.min(width, text.width + 16), height, (box, scope, id) => [
				shape(
					`${id}:box`,
					"badge",
					box,
					WIDGET,
					{ fill: FILL, stroke: LINE },
					component.text ?? "",
					scope,
				),
				freeText(
					`${id}:text`,
					text,
					SMALL,
					{ x: box.x, y: box.y + Math.round((box.height - text.height) / 2), width: box.width },
					"center",
					TEXT,
					scope,
				),
			]);
		}
		case "button": {
			const own = Math.min(width, Math.max(80, lineWidth(component.text, BODY) + 32));
			const text = wrapTextToWidth(component.text ?? "", own - 32, BODY);
			const lines = text.split("\n").length;
			const height = Math.max(device.control, Math.ceil(lines * BODY * 1.35) + 18);
			const primary = component.variant === "primary";
			const disabled = component.disabled === true;
			const fill = disabled ? FILL : primary ? WIREFRAME_ACCENT : WHITE;
			const stroke = disabled ? LINE : primary ? WIREFRAME_ACCENT : STROKE;
			const color = disabled ? MUTED : primary ? WHITE : INK;
			return leaf(component, path, own, height, (box, scope, id) => {
				const node = shape(
					`${id}:box`,
					"button",
					box,
					WIDGET,
					{ fill, stroke },
					component.text ?? "",
					scope,
				);
				return [node, boundText(`${id}:label`, node, text, BODY, box.width - 32, color, scope)];
			});
		}
		case "input":
		case "textarea":
		case "select":
		case "search":
			return layoutField(component, context, width, path);
		case "checkbox":
		case "radio": {
			const text = wrap(component.label ?? "", width - BOX - 8, BODY);
			const height = Math.max(BOX, text.height, touch);
			return leaf(
				component,
				path,
				Math.min(width, BOX + 8 + text.width),
				height,
				(box, scope, id) => {
					const top = box.y + Math.round((box.height - Math.max(BOX, text.height)) / 2);
					const boxTop =
						top +
						(text.lines > 1
							? Math.max(0, Math.round((BODY * LINE_HEIGHT - BOX) / 2))
							: Math.round((Math.max(BOX, text.height) - BOX) / 2));
					const square: Box = { x: box.x, y: boxTop, width: BOX, height: BOX };
					const on = component.checked === true;
					const elements: SceneElement[] = [];
					if (component.type === "checkbox") {
						elements.push(
							shape(
								`${id}:box`,
								"checkbox",
								square,
								WIDGET,
								on
									? { fill: WIREFRAME_ACCENT, stroke: WIREFRAME_ACCENT }
									: { fill: WHITE, stroke: STROKE },
								component.label ?? "",
								scope,
							),
						);
						if (on)
							elements.push(
								line(
									`${id}:check-0`,
									[
										{ x: square.x + 4, y: square.y + 9 },
										{ x: square.x + 8, y: square.y + 13 },
									],
									WHITE,
									2,
									scope,
								),
								line(
									`${id}:check-1`,
									[
										{ x: square.x + 8, y: square.y + 13 },
										{ x: square.x + 14, y: square.y + 5 },
									],
									WHITE,
									2,
									scope,
								),
							);
					} else {
						elements.push(
							shape(
								`${id}:box`,
								"radio",
								square,
								WIDGET,
								{ fill: WHITE, stroke: on ? WIREFRAME_ACCENT : STROKE, shape: "ellipse" },
								component.label ?? "",
								scope,
							),
						);
						if (on)
							elements.push(
								shape(
									`${id}:dot`,
									"radio-dot",
									{ x: square.x + 5, y: square.y + 5, width: 8, height: 8 },
									WIDGET,
									{ fill: WIREFRAME_ACCENT, stroke: WIREFRAME_ACCENT, shape: "ellipse" },
									"selected",
									scope,
								),
							);
					}
					elements.push(
						freeText(
							`${id}:text`,
							text,
							BODY,
							{
								x: box.x + BOX + 8,
								y: top + Math.round((Math.max(BOX, text.height) - text.height) / 2),
								width: text.width,
							},
							"left",
							INK,
							scope,
						),
					);
					return elements;
				},
			);
		}
		case "toggle": {
			const text = wrap(component.label ?? "", width - 16 - TRACK_WIDTH, BODY);
			const height = Math.max(TRACK_HEIGHT, text.height, touch);
			return leaf(component, path, width, height, (box, scope, id) => {
				const on = component.checked === true;
				const track: Box = {
					x: box.x + box.width - TRACK_WIDTH,
					y: box.y + Math.round((box.height - TRACK_HEIGHT) / 2),
					width: TRACK_WIDTH,
					height: TRACK_HEIGHT,
				};
				const knobX = on ? track.x + track.width - 3 - KNOB : track.x + 3;
				return [
					freeText(
						`${id}:text`,
						text,
						BODY,
						{ x: box.x, y: box.y + Math.round((box.height - text.height) / 2), width: text.width },
						"left",
						INK,
						scope,
					),
					{
						...shape(
							`${id}:track`,
							"toggle",
							track,
							WIDGET,
							on
								? { fill: WIREFRAME_ACCENT, stroke: WIREFRAME_ACCENT }
								: { fill: FILL_DARK, stroke: LINE },
							`${component.label ?? "Toggle"}: ${on ? "on" : "off"}`,
							scope,
						),
						shape: "polygon" as const,
						points: stadium(TRACK_WIDTH, TRACK_HEIGHT),
					},
					shape(
						`${id}:knob`,
						"toggle-knob",
						{ x: knobX, y: track.y + (TRACK_HEIGHT - KNOB) / 2, width: KNOB, height: KNOB },
						WIDGET,
						{ fill: WHITE, stroke: on ? WIREFRAME_ACCENT : STROKE, shape: "ellipse" },
						on ? "on" : "off",
						scope,
					),
				];
			});
		}
		case "tabs":
			return layoutTabs(component, context, width, path);
		case "nav":
			return layoutNav(component, context, width, path);
		case "breadcrumbs": {
			const text = wrap(breadcrumbText(component), width, LABEL);
			return leaf(component, path, Math.min(width, text.width), text.height, (box, scope, id) => [
				freeText(`${id}:text`, text, LABEL, box, "left", MUTED, scope),
			]);
		}
		case "avatar": {
			const size = context.mobile ? Math.max(AVATAR, touch) : AVATAR;
			return leaf(component, path, size, size, (box, scope, id) => {
				const node = shape(
					`${id}:box`,
					"avatar",
					box,
					WIDGET,
					{ fill: FILL_DARK, stroke: STROKE, shape: "ellipse" },
					component.label ?? "Avatar",
					scope,
				);
				if (!component.label) return [node];
				const room = canvasBoundTextBox(node).width;
				let initials = orgPersonInitials(component.label);
				if (estimateTextWidth(initials, SMALL) + 24 > size) initials = [...initials][0] ?? "?";
				return [node, boundText(`${id}:label`, node, initials, SMALL, room, INK, scope)];
			});
		}
		case "icon": {
			const hit = context.mobile ? touch : ICON;
			const text = component.label ? wrap(component.label, width - hit - 8, BODY) : undefined;
			const height = Math.max(hit, text?.height ?? 0);
			return leaf(
				component,
				path,
				Math.min(width, hit + (text ? 8 + text.width : 0)),
				height,
				(box, scope, id) => {
					const glyph: Box = {
						x: box.x + (hit - ICON) / 2,
						y: box.y + Math.round((box.height - ICON) / 2),
						width: ICON,
						height: ICON,
					};
					const elements: SceneElement[] = [
						shape(
							`${id}:box`,
							"icon",
							glyph,
							WIDGET,
							{ fill: FILL_DARK, stroke: STROKE, shape: "ellipse" },
							component.label ?? "Icon",
							scope,
						),
					];
					if (text)
						elements.push(
							freeText(
								`${id}:text`,
								text,
								BODY,
								{
									x: box.x + hit + 8,
									y: box.y + Math.round((box.height - text.height) / 2),
									width: text.width,
								},
								"left",
								TEXT,
								scope,
							),
						);
					return elements;
				},
			);
		}
		case "image":
			return layoutImage(component, context, width, path);
		case "chart":
			return layoutChart(component, width, path);
		case "table":
			return layoutTable(component, context, width, path);
		case "list": {
			const texts = (component.items ?? []).map((item) => wrap(item, width - BULLET - 12, BODY));
			const height =
				texts.reduce((sum, text) => sum + text.height, 0) + 8 * Math.max(0, texts.length - 1);
			return leaf(component, path, width, height, (box, scope, id) => {
				let y = box.y;
				return texts.flatMap((text, index) => {
					const top = y;
					y += text.height + 8;
					return [
						shape(
							`${id}:bullet-${index}`,
							"bullet",
							{
								x: box.x + 2,
								y: top + (BODY * LINE_HEIGHT - BULLET) / 2,
								width: BULLET,
								height: BULLET,
							},
							WIDGET,
							{ fill: TEXT, stroke: TEXT, shape: "ellipse" },
							"•",
							scope,
						),
						freeText(
							`${id}:item-${index}`,
							text,
							BODY,
							{ x: box.x + BULLET + 12, y: top, width: text.width },
							"left",
							TEXT,
							scope,
						),
					];
				});
			});
		}
		case "divider":
			return leaf(component, path, width, 1, (box, scope, id) => [
				line(
					`${id}:line`,
					[
						{ x: box.x, y: box.y + 0.5 },
						{ x: box.x + box.width, y: box.y + 0.5 },
					],
					LINE,
					1,
					scope,
				),
			]);
		default:
			return layoutContainer(component, context, width, path, titleHeight);
	}
}

/** A stadium (a rectangle with round ends) as polygon points from its top left. */
function stadium(
	width: number,
	height: number,
): [ScenePoint, ScenePoint, ScenePoint, ...ScenePoint[]] {
	const radius = height / 2;
	const points: ScenePoint[] = [];
	const arc = (cx: number, from: number) => {
		for (let step = 0; step <= 8; step += 1) {
			const angle = from + (Math.PI * step) / 8;
			points.push({
				x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
				y: Math.round((radius + radius * Math.sin(angle)) * 100) / 100,
			});
		}
	};
	arc(width - radius, -Math.PI / 2);
	arc(radius, Math.PI / 2);
	return points as [ScenePoint, ScenePoint, ScenePoint, ...ScenePoint[]];
}

function layoutField(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
): Laid {
	const { device } = context;
	const type = component.type;
	const label = component.label ? wrap(component.label, width, LABEL) : undefined;
	const filled = component.value !== undefined;
	const inside =
		component.value ?? component.placeholder ?? (type === "search" ? "Search" : undefined);
	const trailing = type === "select" || type === "search" ? 36 : 0;
	const text = inside ? wrap(inside, width - 2 * FIELD_PAD - trailing, BODY) : undefined;
	const rows = type === "textarea" ? (component.rows ?? 3) : 1;
	const boxHeight =
		type === "textarea"
			? Math.max(device.control, rows * PLACEHOLDER_PITCH + 16, (text?.height ?? 0) + 20)
			: Math.max(device.control, (text?.height ?? 0) + 16);
	const top = label ? label.height + LABEL_GAP : 0;
	const disabled = component.disabled === true;
	return leaf(component, path, width, top + boxHeight, (box, scope, id) => {
		const field: Box = { x: box.x, y: box.y + top, width: box.width, height: boxHeight };
		const elements: SceneElement[] = [];
		if (label) elements.push(freeText(`${id}:label`, label, LABEL, box, "left", TEXT, scope));
		elements.push(
			shape(
				`${id}:box`,
				type,
				field,
				WIDGET,
				{ fill: disabled ? FILL : WHITE, stroke: disabled ? LINE : STROKE },
				inside ?? component.label ?? type,
				scope,
			),
		);
		if (text)
			elements.push(
				freeText(
					`${id}:${filled ? "value" : "placeholder"}`,
					text,
					BODY,
					{
						x: field.x + FIELD_PAD,
						y:
							type === "textarea"
								? field.y + 10
								: field.y + Math.round((boxHeight - text.height) / 2),
						width: text.width,
					},
					"left",
					filled && !disabled ? INK : MUTED,
					scope,
				),
			);
		const cy = field.y + boxHeight / 2;
		const right = field.x + field.width;
		if (type === "select")
			elements.push(
				line(
					`${id}:chevron-0`,
					[
						{ x: right - 24, y: cy - 3 },
						{ x: right - 18, y: cy + 3 },
					],
					STROKE,
					2,
					scope,
				),
				line(
					`${id}:chevron-1`,
					[
						{ x: right - 18, y: cy + 3 },
						{ x: right - 12, y: cy - 3 },
					],
					STROKE,
					2,
					scope,
				),
			);
		if (type === "search")
			elements.push(
				shape(
					`${id}:lens`,
					"search-lens",
					{ x: right - 28, y: cy - 7, width: 11, height: 11 },
					WIDGET,
					{ fill: WHITE, stroke: STROKE, shape: "ellipse" },
					"Search",
					scope,
				),
				line(
					`${id}:handle`,
					[
						{ x: right - 18.5, y: cy + 2.5 },
						{ x: right - 14, y: cy + 7 },
					],
					STROKE,
					2,
					scope,
				),
			);
		return elements;
	});
}

function layoutTabs(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
): Laid {
	return layoutItems(component, context, width, path, "tabs");
}

/** Tabs and horizontal nav items run in lines that wrap; a sidebar's nav stacks. */
function layoutItems(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
	kind: "tabs" | "nav",
): Laid {
	const items = component.items ?? [];
	const vertical = kind === "nav" && context.inSidebar;
	const height = Math.max(kind === "tabs" ? 38 : 36, context.device.touch);
	const gap = 4;
	const placed: { box: Box; text: Wrapped; item: string }[] = [];
	/** The bottom of each line of items; tabs draw a rule along each. */
	const bottoms: number[] = [];
	if (vertical) {
		for (const item of items) {
			const text = wrap(item, width - 2 * TAB_PAD, BODY);
			const top = placed.length ? placed.at(-1)!.box.y + placed.at(-1)!.box.height + gap : 0;
			placed.push({
				item,
				text,
				box: { x: 0, y: top, width, height: Math.max(height, text.height + 16) },
			});
		}
	} else {
		let x = 0;
		let y = 0;
		let row: { item: string; text: Wrapped; x: number; width: number }[] = [];
		const close = () => {
			const lineHeight = Math.max(height, ...row.map(({ text }) => text.height + 16));
			for (const entry of row)
				placed.push({
					item: entry.item,
					text: entry.text,
					box: { x: entry.x, y, width: entry.width, height: lineHeight },
				});
			bottoms.push(y + lineHeight);
			y += lineHeight + gap;
			row = [];
			x = 0;
		};
		for (const item of items) {
			const text = wrap(item, width - 2 * TAB_PAD, BODY);
			const itemWidth = Math.min(width, text.width + 2 * TAB_PAD);
			if (x > 0 && x + itemWidth > width) close();
			row.push({ item, text, x, width: itemWidth });
			x += itemWidth + gap;
		}
		if (row.length) close();
	}
	const total = Math.max(0, ...placed.map(({ box }) => box.y + box.height));
	const used = vertical ? width : Math.max(0, ...placed.map(({ box }) => box.x + box.width));
	const ownWidth = kind === "tabs" || vertical ? width : Math.min(width, used);
	const centered = !vertical && context.textAlign === "center";
	return leaf(component, path, ownWidth, total + (kind === "tabs" ? 1 : 0), (box, scope, id) => {
		const elements: SceneElement[] = [];
		const offset = centered && kind === "tabs" ? Math.round((box.width - used) / 2) : 0;
		if (kind === "tabs")
			bottoms.forEach((bottom, index) =>
				elements.push(
					line(
						`${id}:baseline${index ? `-${index}` : ""}`,
						[
							{ x: box.x, y: box.y + bottom + 0.5 },
							{ x: box.x + box.width, y: box.y + bottom + 0.5 },
						],
						LINE,
						1,
						scope,
					),
				),
			);
		placed.forEach(({ item, text, box: itemBox }, index) => {
			const at: Box = {
				x: box.x + offset + itemBox.x,
				y: box.y + itemBox.y,
				width: itemBox.width,
				height: itemBox.height,
			};
			// Of repeated items, the first is the active one.
			const active = component.active === item && items.indexOf(item) === index;
			if (active && kind === "nav")
				elements.push(
					shape(
						`${id}:active`,
						"nav-active",
						at,
						WIDGET,
						{ fill: ACCENT_TINT, stroke: ACCENT_TINT },
						`${item} (active)`,
						scope,
					),
				);
			elements.push(
				freeText(
					`${id}:item-${index}`,
					text,
					BODY,
					{
						x: at.x + TAB_PAD,
						y: at.y + Math.round((at.height - text.height) / 2),
						width: at.width - 2 * TAB_PAD,
					},
					"left",
					active ? WIREFRAME_ACCENT : TEXT,
					scope,
				),
			);
			if (active && kind === "tabs")
				elements.push(
					line(
						`${id}:active`,
						[
							{ x: at.x + 4, y: at.y + at.height - 1 },
							{ x: at.x + at.width - 4, y: at.y + at.height - 1 },
						],
						WIREFRAME_ACCENT,
						2,
						scope,
					),
				);
		});
		return elements;
	});
}

function layoutNav(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
): Laid {
	return layoutItems(component, context, width, path, "nav");
}

function layoutImage(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
): Laid {
	const ratio = component.aspect === "square" ? 1 : component.aspect === "tall" ? 4 / 3 : 9 / 16;
	const cap = context.mobile ? 280 : context.device === WIREFRAME_DEVICE_METRICS.tablet ? 360 : 480;
	// A capped height narrows the box, so a square stays square.
	const own = Math.max(
		Math.min(width, longestWord(component.label, LABEL) + 24),
		Math.min(width, Math.round(cap / ratio)),
	);
	const height = Math.max(48, Math.min(cap, Math.round(own * ratio)));
	const label = component.label ? wrap(component.label, own - 24, LABEL) : undefined;
	return leaf(
		component,
		path,
		own,
		Math.max(height, (label?.height ?? 0) + 24),
		(box, scope, id) => {
			const elements: SceneElement[] = [
				shape(
					`${id}:box`,
					"image",
					box,
					REGION,
					{ fill: FILL, stroke: LINE },
					component.label ?? "Image",
					scope,
				),
			];
			const corners: [ScenePoint, ScenePoint][] = [
				[
					{ x: box.x, y: box.y },
					{ x: box.x + box.width, y: box.y + box.height },
				],
				[
					{ x: box.x + box.width, y: box.y },
					{ x: box.x, y: box.y + box.height },
				],
			];
			const hole = label
				? {
						left: box.x + (box.width - label.width) / 2 - 6,
						right: box.x + (box.width + label.width) / 2 + 6,
						top: box.y + (box.height - label.height) / 2 - 4,
						bottom: box.y + (box.height + label.height) / 2 + 4,
					}
				: undefined;
			corners.forEach(([from, to], index) => {
				const pieces = hole ? splitAround(from, to, hole) : [[from, to] as const];
				pieces.forEach(([start, end], piece) =>
					elements.push(
						line(`${id}:cross-${index}${piece ? `-${piece}` : ""}`, [start, end], LINE, 1, scope),
					),
				);
			});
			if (label)
				elements.push(
					freeText(
						`${id}:text`,
						label,
						LABEL,
						{ x: box.x, y: box.y + (box.height - label.height) / 2, width: box.width },
						"center",
						MUTED,
						scope,
					),
				);
			return elements;
		},
	);
}

/** The parts of a segment outside a box: a diagonal broken where a label sits. */
function splitAround(
	from: ScenePoint,
	to: ScenePoint,
	hole: { left: number; right: number; top: number; bottom: number },
): (readonly [ScenePoint, ScenePoint])[] {
	// Liang–Barsky: the stretch of the segment inside the hole.
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	let enter = 0;
	let leave = 1;
	for (const [p, q] of [
		[-dx, from.x - hole.left],
		[dx, hole.right - from.x],
		[-dy, from.y - hole.top],
		[dy, hole.bottom - from.y],
	] as const) {
		if (p === 0) {
			if (q < 0) return [[from, to]];
			continue;
		}
		const t = q / p;
		if (p < 0) enter = Math.max(enter, t);
		else leave = Math.min(leave, t);
	}
	if (enter >= leave) return [[from, to]];
	const at = (t: number) => ({ x: from.x + dx * t, y: from.y + dy * t });
	return [
		...(enter > 0.02 ? [[from, at(enter)] as const] : []),
		...(leave < 0.98 ? [[at(leave), to] as const] : []),
	];
}

const BAR_SHARES = [0.45, 0.7, 0.55, 0.85, 0.65, 0.95];
const LINE_SHARES = [0.3, 0.55, 0.45, 0.7, 0.6, 0.85, 0.75];

function layoutChart(component: WireframeComponent, width: number, path: string): Laid {
	const label = component.label ? wrap(component.label, width - 24, LABEL) : undefined;
	const plotHeight = Math.max(120, Math.min(280, Math.round(width * 0.4)));
	const head = label ? label.height + 12 : 0;
	const height = 16 + head + plotHeight + 16;
	return leaf(component, path, width, height, (box, scope, id) => {
		const elements: SceneElement[] = [
			shape(
				`${id}:box`,
				"chart",
				box,
				REGION,
				{ fill: WHITE, stroke: LINE },
				component.label ?? "Chart",
				scope,
			),
		];
		if (label)
			elements.push(
				freeText(
					`${id}:title`,
					label,
					LABEL,
					{ x: box.x + 16, y: box.y + 16, width: label.width },
					"left",
					TEXT,
					scope,
				),
			);
		const plot: Box = {
			x: box.x + 24,
			y: box.y + 16 + head,
			width: box.width - 48,
			height: plotHeight,
		};
		const kind = component.kind ?? "bar";
		if (kind === "pie") {
			const size = Math.min(plot.width, plot.height);
			const circle: Box = {
				x: plot.x + (plot.width - size) / 2,
				y: plot.y,
				width: size,
				height: size,
			};
			const cx = circle.x + size / 2;
			const cy = circle.y + size / 2;
			elements.push(
				shape(
					`${id}:pie`,
					"chart-pie",
					circle,
					WIDGET,
					{ fill: FILL, stroke: STROKE, shape: "ellipse" },
					"Pie",
					scope,
				),
			);
			[-90, 40, 150].forEach((degrees, index) => {
				const angle = (degrees * Math.PI) / 180;
				elements.push(
					line(
						`${id}:slice-${index}`,
						[
							{ x: cx, y: cy },
							{ x: cx + (size / 2) * Math.cos(angle), y: cy + (size / 2) * Math.sin(angle) },
						],
						STROKE,
						1,
						scope,
					),
				);
			});
			return elements;
		}
		const base = plot.y + plot.height;
		elements.push(
			line(
				`${id}:x-axis`,
				[
					{ x: plot.x, y: base },
					{ x: plot.x + plot.width, y: base },
				],
				STROKE,
				1,
				scope,
			),
			line(
				`${id}:y-axis`,
				[
					{ x: plot.x, y: plot.y },
					{ x: plot.x, y: base },
				],
				STROKE,
				1,
				scope,
			),
		);
		if (kind === "line") {
			const step = (plot.width - 16) / (LINE_SHARES.length - 1);
			elements.push(
				line(
					`${id}:series`,
					LINE_SHARES.map((share, index) => ({
						x: plot.x + 8 + step * index,
						y: base - 8 - (plot.height - 16) * share,
					})),
					WIREFRAME_ACCENT,
					2,
					scope,
				),
			);
			return elements;
		}
		const slot = (plot.width - 16) / BAR_SHARES.length;
		BAR_SHARES.forEach((share, index) => {
			const barHeight = Math.round((plot.height - 8) * share);
			elements.push(
				shape(
					`${id}:bar-${index}`,
					"chart-bar",
					{
						x: Math.round(plot.x + 8 + slot * index + slot * 0.2),
						y: base - barHeight,
						width: Math.max(4, Math.round(slot * 0.6)),
						height: barHeight,
					},
					REGION,
					{ fill: PLACEHOLDER, stroke: PLACEHOLDER },
					"Bar",
					scope,
				),
			);
		});
		return elements;
	});
}

/** Columns share a table's width, each at least its header's longest word. */
function tableColumns(headers: readonly string[], width: number): number[] | undefined {
	const mins = headers.map((header) => longestWord(header, LABEL) + 2 * FIELD_PAD);
	const total = mins.reduce((sum, min) => sum + min, 0);
	if (total > width) return undefined;
	return waterFill(mins, width);
}

function layoutTable(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
): Laid {
	const headers = tableHeaders(component);
	const rows = component.rows ?? WIREFRAME_DEFAULT_TABLE_ROWS;
	const columns = tableColumns(headers, width);
	const rowHeight = context.mobile ? 44 : 40;
	if (columns) {
		const texts = headers.map((header, index) =>
			wrap(header, columns[index]! - 2 * FIELD_PAD, LABEL),
		);
		const headHeight = Math.max(rowHeight, Math.max(...texts.map((text) => text.height)) + 16);
		const height = headHeight + rows * rowHeight;
		return leaf(component, path, width, height, (box, scope, id) => {
			const elements: SceneElement[] = [
				shape(
					`${id}:box`,
					"table",
					box,
					REGION,
					{ fill: WHITE, stroke: LINE },
					headers.join(" | "),
					scope,
				),
				shape(
					`${id}:head`,
					"table-head",
					{ x: box.x, y: box.y, width: box.width, height: headHeight },
					REGION,
					{ fill: FILL, stroke: LINE },
					"Header",
					scope,
				),
			];
			let x = box.x;
			const lefts = columns.map((column) => {
				const left = x;
				x += column;
				return left;
			});
			texts.forEach((text, index) =>
				elements.push(
					freeText(
						`${id}:header-${index}`,
						text,
						LABEL,
						{
							x: lefts[index]! + FIELD_PAD,
							y: box.y + Math.round((headHeight - text.height) / 2),
							width: text.width,
						},
						"left",
						INK,
						scope,
					),
				),
			);
			for (let row = 0; row < rows; row += 1) {
				const top = box.y + headHeight + row * rowHeight;
				if (row > 0)
					elements.push(
						line(
							`${id}:rule-${row}`,
							[
								{ x: box.x, y: top },
								{ x: box.x + box.width, y: top },
							],
							PLACEHOLDER,
							1,
							scope,
						),
					);
				columns.forEach((column, index) => {
					const share = [0.7, 0.5, 0.62, 0.45, 0.66, 0.55][(row + index * 2) % 6]!;
					const length = Math.max(12, Math.round((column - 2 * FIELD_PAD) * share));
					const left = lefts[index]! + FIELD_PAD;
					elements.push(
						line(
							`${id}:cell-${row}-${index}`,
							[
								{ x: left + 2, y: top + rowHeight / 2 },
								{ x: left + length - 2, y: top + rowHeight / 2 },
							],
							PLACEHOLDER,
							4,
							scope,
						),
					);
				});
			}
			return elements;
		});
	}
	// Too narrow for side-by-side columns: each row stacks its fields, header beside a value line.
	const headerWidth = Math.min(
		Math.floor(width / 2),
		Math.max(...headers.map((header) => lineWidth(header, LABEL))),
	);
	const texts = headers.map((header) =>
		wrap(header, Math.max(headerWidth, longestWord(header, LABEL)), LABEL),
	);
	const fieldHeights = texts.map((text) => Math.max(24, text.height + 6));
	const recordHeight = fieldHeights.reduce((sum, value) => sum + value, 0) + 16;
	const height = rows * recordHeight;
	return leaf(component, path, width, height, (box, scope, id) => {
		const elements: SceneElement[] = [
			shape(
				`${id}:box`,
				"table",
				box,
				REGION,
				{ fill: WHITE, stroke: LINE },
				headers.join(" | "),
				scope,
			),
		];
		for (let row = 0; row < rows; row += 1) {
			let top = box.y + row * recordHeight + 8;
			if (row > 0)
				elements.push(
					line(
						`${id}:rule-${row}`,
						[
							{ x: box.x, y: top - 8 },
							{ x: box.x + box.width, y: top - 8 },
						],
						PLACEHOLDER,
						1,
						scope,
					),
				);
			texts.forEach((text, index) => {
				const fieldHeight = fieldHeights[index]!;
				elements.push(
					freeText(
						`${id}:header-${row}-${index}`,
						text,
						LABEL,
						{
							x: box.x + FIELD_PAD,
							y: top + Math.round((fieldHeight - text.height) / 2),
							width: text.width,
						},
						"left",
						MUTED,
						scope,
					),
				);
				const valueLeft = box.x + FIELD_PAD + Math.max(headerWidth, text.width) + FIELD_PAD;
				const room = box.x + box.width - FIELD_PAD - valueLeft;
				const share = [0.8, 0.55, 0.7, 0.6][(row + index) % 4]!;
				elements.push(
					line(
						`${id}:cell-${row}-${index}`,
						[
							{ x: valueLeft + 2, y: top + fieldHeight / 2 },
							{ x: valueLeft + Math.max(10, room * share) - 2, y: top + fieldHeight / 2 },
						],
						PLACEHOLDER,
						4,
						scope,
					),
				);
				top += fieldHeight;
			});
		}
		return elements;
	});
}

/**
 * Widths at least `mins` that sum to `total`, as even as the mins allow:
 * the widest keep their min and the rest share what is left.
 */
function waterFill(mins: readonly number[], total: number): number[] {
	const result = Array.from({ length: mins.length }, () => 0);
	const order = mins.map((min, index) => ({ min, index })).toSorted((a, b) => b.min - a.min);
	let remaining = total;
	let count = mins.length;
	const free: number[] = [];
	for (const { min, index } of order) {
		if (free.length === 0 && min > remaining / count) {
			result[index] = min;
			remaining -= min;
			count -= 1;
		} else free.push(index);
	}
	free.sort((a, b) => a - b);
	const share = free.length ? Math.floor(remaining / free.length) : 0;
	let extra = remaining - share * free.length;
	for (const index of free) {
		result[index] = share + (extra > 0 ? 1 : 0);
		if (extra > 0) extra -= 1;
	}
	return result;
}

/** Children down a column at `width`: fields stretch unless the column centers or ends them. */
function stackColumn(
	children: readonly WireframeComponent[],
	context: Context,
	width: number,
	gap: number,
	align: WireframeAlignment,
	paths: readonly string[],
): { laid: Laid[]; height: number } {
	let y = 0;
	const laid = children.map((child, index) => {
		const own = columnWidth(measure(child, context), width, align);
		const placed = layout(child, context, own, paths[index]!);
		placed.x =
			align === "center"
				? Math.floor((width - placed.width) / 2)
				: align === "end"
					? width - placed.width
					: 0;
		placed.y = y;
		y += placed.height + gap;
		return placed;
	});
	return { laid, height: Math.max(0, y - gap) };
}

/** Children across a row at `width`, wrapping onto new lines rather than overflowing. */
function arrangeRow(
	children: readonly WireframeComponent[],
	context: Context,
	width: number,
	gap: number,
	align: WireframeAlignment,
	paths: readonly string[],
): { laid: Laid[]; height: number; spread: boolean } {
	const sizes = children.map((child) => measure(child, context));
	const hugging = align === "center" || align === "end";
	const lines: number[][] = [];
	let current: number[] = [];
	let used = 0;
	sizes.forEach((size, index) => {
		const need = size.min;
		if (current.length > 0 && used + gap + need > width) {
			lines.push(current);
			current = [];
			used = 0;
		}
		used += (current.length > 0 ? gap : 0) + need;
		current.push(index);
	});
	if (current.length) lines.push(current);
	const laid: Laid[] = [];
	let y = 0;
	let spread = false;
	for (const members of lines) {
		const available = width - gap * (members.length - 1);
		const mins = members.map((index) => sizes[index]!.min);
		const minTotal = mins.reduce((sum, min) => sum + min, 0);
		const growing = members.filter((index) => !hugging && sizes[index]!.grow);
		const hugs = members.filter((index) => hugging || !sizes[index]!.grow);
		const widths = new Map(members.map((index) => [index, sizes[index]!.min]));
		let free = available - minTotal;
		const hugNeed = hugs.reduce(
			(sum, index) => sum + Math.max(0, sizes[index]!.pref - sizes[index]!.min),
			0,
		);
		for (const index of hugs) {
			const room = Math.max(0, sizes[index]!.pref - sizes[index]!.min);
			const share = hugNeed <= free ? room : Math.floor((room * free) / Math.max(1, hugNeed));
			widths.set(index, sizes[index]!.min + share);
		}
		free = available - [...widths.values()].reduce((sum, value) => sum + value, 0);
		if (growing.length > 0 && free > 0) {
			const filled = waterFill(
				growing.map((index) => widths.get(index)!),
				growing.reduce((sum, index) => sum + widths.get(index)!, 0) + free,
			);
			growing.forEach((index, at) => widths.set(index, filled[at]!));
		}
		const placed = layoutLine((titleHeight) =>
			members.map((index) =>
				layout(children[index]!, context, widths.get(index)!, paths[index]!, titleHeight),
			),
		);
		const lineHeight = Math.max(0, ...placed.map((item) => item.height));
		const taken = placed.reduce((sum, item) => sum + item.width, 0) + gap * (placed.length - 1);
		const leftover = Math.max(0, width - taken);
		let x = align === "center" ? Math.floor(leftover / 2) : align === "end" ? leftover : 0;
		const between = align === "between" && placed.length > 1 && leftover > 0;
		spread ||= between;
		const step = between ? leftover / (placed.length - 1) : 0;
		placed.forEach((item, at) => {
			item.x = Math.round(x + (between ? step * at : 0));
			if (item.stretch) item.height = lineHeight;
			item.y = y + Math.round((lineHeight - item.height) / 2);
			x += item.width + gap;
			laid.push(item);
		});
		y += lineHeight + gap;
	}
	return { laid, height: Math.max(0, y - gap), spread };
}

function arrangeGrid(
	component: WireframeComponent,
	children: readonly WireframeComponent[],
	context: Context,
	width: number,
	gap: number,
	paths: readonly string[],
): { laid: Laid[]; height: number } {
	const sizes = children.map((child) => measure(child, context));
	const widest = Math.max(0, ...sizes.map((size) => size.min));
	let columns = Math.max(
		1,
		Math.min(typeof component.columns === "number" ? component.columns : 1, children.length),
	);
	const cell = (count: number) => Math.floor((width - gap * (count - 1)) / count);
	while (columns > 1 && cell(columns) < widest) columns -= 1;
	const cellWidth = cell(columns);
	const laid: Laid[] = [];
	let y = 0;
	for (let start = 0; start < children.length; start += columns) {
		const row = layoutLine((titleHeight) =>
			children
				.slice(start, start + columns)
				.map((child, at) =>
					layout(
						child,
						context,
						Math.max(cellWidth, sizes[start + at]!.min),
						paths[start + at]!,
						titleHeight,
					),
				),
		);
		const rowHeight = Math.max(...row.map((item) => item.height));
		row.forEach((item, at) => {
			item.x = at * (cellWidth + gap);
			item.y = y;
			if (item.stretch) item.height = rowHeight;
			laid.push(item);
		});
		y += rowHeight + gap;
	}
	return { laid, height: Math.max(0, y - gap) };
}

/** A container's title, drawn as a heading-sized line at its top. */
function containerTitle(
	component: WireframeComponent,
	context: Context,
	width: number,
): { readonly text: Wrapped; readonly size: number } | undefined {
	if (!component.title || ROWS.has(component.type)) return undefined;
	const room = component.type === "modal" ? width - 32 : width;
	const size = fitSize(
		component.title,
		containerTitleSize(component.type, context),
		room,
		TITLE_FLOOR,
	);
	return { text: wrap(component.title, room, size), size };
}

function layoutContainer(
	component: WireframeComponent,
	context: Context,
	width: number,
	path: string,
	titleHeight?: number,
): Laid {
	const type = component.type;
	const inner = childContext(component, context);
	const pad = containerPad(type, context);
	const gap = containerGap(type, context);
	const align = component.align ?? (type === "header" || type === "footer" ? "between" : "start");
	const contentWidth = width - 2 * pad.x;
	const children = component.children ?? [];
	const fitted = containerTitle(component, context, contentWidth);
	const title = fitted?.text;
	const titleSize = fitted?.size ?? containerTitleSize(type, context);
	const close = type === "modal" ? wrap("×", 24, 20) : undefined;
	// A modal's close mark keeps a row of its own above the content, title or none.
	// A title shares the height of the tallest beside it, so what follows each lines up.
	const headHeight = Math.max(
		title ? Math.max(title.height, titleHeight ?? 0) : 0,
		close?.height ?? 0,
	);
	const titleGap = headHeight && children.length ? (type === "modal" ? 16 : STACK_GAP) : 0;
	let laid: Laid[];
	let contentHeight: number;
	let flow: WireframeFlow;
	const paths = children.map((_, index) => `${path}.${index}`);
	if (ROWS.has(type)) {
		// A header's or footer's title leads its row as the product name.
		const items: WireframeComponent[] = component.title
			? [{ type: "heading", text: component.title }, ...children]
			: [...children];
		const row = arrangeRow(
			items,
			inner,
			contentWidth,
			gap,
			align,
			component.title ? [`${path}.title`, ...paths] : paths,
		);
		laid = row.laid;
		contentHeight = row.height;
		flow = { axis: "row", gap, spread: row.spread };
	} else if (type === "grid") {
		const grid = arrangeGrid(component, children, inner, contentWidth, gap, paths);
		laid = grid.laid;
		contentHeight = grid.height;
		flow = { axis: "grid", gap, spread: false };
	} else {
		const column = stackColumn(children, inner, contentWidth, gap, align, paths);
		laid = column.laid;
		contentHeight = column.height;
		flow = { axis: "column", gap, spread: false };
	}
	const top = pad.y + (headHeight ? headHeight + titleGap : 0);
	for (const child of laid) {
		child.x += pad.x;
		child.y += top;
	}
	const bar = type === "header" || type === "footer";
	const height = Math.max(
		top + contentHeight + pad.y,
		bar ? context.device.barHeight : 0,
		type === "card" || type === "modal" ? 2 * pad.y : 0,
	);
	if (bar && height > top + contentHeight + pad.y) {
		const shift = Math.round((height - (top + contentHeight + pad.y)) / 2);
		for (const child of laid) child.y += shift;
	}
	const titled = (box: Box, scope: Scope, id: string): SceneElement[] =>
		title
			? [
					freeText(
						`${id}:title`,
						title,
						titleSize,
						{ x: box.x + pad.x, y: box.y + pad.y, width: close ? contentWidth - 32 : contentWidth },
						inner.textAlign,
						INK,
						scope,
					),
				]
			: [];
	const paint = (box: Box, scope: Scope, id: string): SceneElement[] => {
		switch (type) {
			case "card":
				return [
					shape(
						`${id}:box`,
						"card",
						box,
						WIDGET,
						{ fill: WHITE, stroke: LINE },
						component.title ?? "Card",
						scope,
					),
					...titled(box, scope, id),
				];
			case "modal": {
				const mark = close!;
				return [
					shape(
						`${id}:box`,
						"modal",
						box,
						WIDGET,
						{ fill: WHITE, stroke: STROKE, strokeWidth: 2 },
						component.title ?? "Dialog",
						scope,
					),
					...titled(box, scope, id),
					freeText(
						`${id}:close`,
						mark,
						20,
						{ x: box.x + box.width - pad.x - mark.width, y: box.y + pad.y, width: mark.width },
						"left",
						MUTED,
						scope,
					),
				];
			}
			case "header":
			case "footer":
			case "sidebar":
				return [
					shape(
						`${id}:box`,
						type,
						box,
						REGION,
						{ fill: FILL, stroke: LINE },
						component.title ?? type,
						scope,
					),
					...titled(box, scope, id),
				];
			default:
				return titled(box, scope, id);
		}
	};
	return {
		component,
		path,
		width,
		height,
		x: 0,
		y: 0,
		children: laid,
		flow,
		stretch: type === "card" || type === "section" || type === "column" || type === "modal",
		...(title ? { titleHeight: title.height } : {}),
		paint,
	};
}

/**
 * Lay out a line of siblings, then again with every title as tall as the
 * tallest, so the values in a row of cards sit level whatever their titles wrap to.
 */
function layoutLine(lay: (titleHeight?: number) => Laid[]): Laid[] {
	const first = lay();
	const titles = first.flatMap((item) =>
		item.titleHeight === undefined ? [] : [item.titleHeight],
	);
	if (titles.length < 2 || Math.min(...titles) === Math.max(...titles)) return first;
	return lay(Math.max(...titles));
}

// ----------------------------------------------------------------- screens

/** A component box in screen coordinates, for checks that read a layout back. */
export interface WireframeLayoutComponent {
	readonly path: string;
	readonly type: WireframeComponentType;
	readonly box: Box;
	/** The path of the component that holds it; undefined at the top of its screen. */
	readonly parent: string | undefined;
	readonly flow?: WireframeFlow;
	/** Drawn over the rest of its screen: a modal and everything in it. */
	readonly overlay: boolean;
	readonly group: string;
}

export interface WireframeLayoutScreen {
	readonly id: string;
	readonly device: WireframeDevice;
	readonly frame: Box;
	/** The screen's own frame width grew past its device to fit a word. */
	readonly widened: boolean;
	readonly components: readonly WireframeLayoutComponent[];
}

/** A control that opens another screen, and whether its arrow found a route. */
export interface WireframeLayoutNavigation {
	readonly screen: string;
	readonly path: string;
	readonly target: string;
	readonly routed: boolean;
}

export interface WireframeLayout {
	readonly screens: readonly WireframeLayoutScreen[];
	readonly navigations: readonly WireframeLayoutNavigation[];
}

interface PlacedScreen {
	readonly screen: WireframeScreen;
	readonly width: number;
	readonly height: number;
	readonly widened: boolean;
	/** Top-level components, positioned relative to the screen. */
	readonly laid: Laid[];
	readonly scrim: boolean;
	readonly modals: ReadonlySet<string>;
}

function layoutScreen(screen: WireframeScreen): PlacedScreen {
	const device = WIREFRAME_DEVICE_METRICS[screen.device];
	const mobile = screen.device === "mobile";
	const context: Context = {
		device,
		mobile,
		inSidebar: false,
		headingLevel: 1,
		textAlign: screen.align === "center" ? "center" : "left",
	};
	const indexed = screen.children.map((component, index) => ({ component, index }));
	const isBar = (type: string) => type === "header" || type === "footer";
	const headers = indexed.filter(({ component }) => component.type === "header");
	const footers = indexed.filter(({ component }) => component.type === "footer");
	const sidebars = mobile ? [] : indexed.filter(({ component }) => component.type === "sidebar");
	const modals = indexed.filter(({ component }) => component.type === "modal");
	const body = indexed.filter(
		({ component }) =>
			!isBar(component.type) &&
			component.type !== "modal" &&
			(mobile || component.type !== "sidebar"),
	);
	const sideWidth = (side: "left" | "right") =>
		sidebars
			.filter(({ component }) => (component.side ?? "left") === side)
			.reduce((sum, { component }) => sum + measure(component, context).min, 0);
	const align = screen.align ?? "start";
	const bodyMin = Math.max(0, ...body.map(({ component }) => measure(component, context).min));
	const barMin = Math.max(
		0,
		...[...headers, ...footers, ...modals].map(({ component }) => measure(component, context).min),
	);
	const width = Math.max(
		device.width,
		sideWidth("left") + sideWidth("right") + bodyMin + 2 * device.pad,
		barMin + (modals.length ? 2 * device.pad : 0),
	);
	const at = (index: number) => String(index);
	const laid: Laid[] = [];
	let top = 0;
	for (const { component, index } of headers) {
		const item = layout(component, context, width, at(index));
		item.x = 0;
		item.y = top;
		top += item.height;
		laid.push(item);
	}
	const left = sideWidth("left");
	const right = sideWidth("right");
	const contentWidth = width - left - right - 2 * device.pad;
	const bodyItems: Laid[] = [];
	let y = device.pad;
	body.forEach(({ component, index }) => {
		const own = columnWidth(measure(component, context), contentWidth, align);
		const item = layout(component, context, own, at(index));
		item.x =
			left +
			device.pad +
			(align === "center"
				? Math.floor((contentWidth - item.width) / 2)
				: align === "end"
					? contentWidth - item.width
					: 0);
		item.y = top + y;
		y += item.height + device.gap;
		bodyItems.push(item);
	});
	const contentHeight = body.length ? y - device.gap + device.pad : 0;
	const sideItems = sidebars.map(({ component, index }) => {
		const size = measure(component, context);
		return layout(component, context, size.min, at(index));
	});
	const footerItems = footers.map(({ component, index }) =>
		layout(component, context, width, at(index)),
	);
	const footerHeight = footerItems.reduce((sum, item) => sum + item.height, 0);
	const modalItems = modals.map(({ component, index }) => {
		const size = measure(component, context);
		return layout(
			component,
			context,
			Math.max(size.min, Math.min(size.pref, width - 2 * device.pad)),
			at(index),
		);
	});
	const modalHeight =
		modalItems.reduce((sum, item) => sum + item.height, 0) +
		device.gap * Math.max(0, modalItems.length - 1);
	let bodyHeight = Math.max(contentHeight, ...sideItems.map((item) => item.height));
	let height = Math.max(
		device.minHeight,
		top + bodyHeight + footerHeight,
		modalHeight + 2 * device.pad,
	);
	bodyHeight = height - top - footerHeight;
	let sideX = { left: 0, right: width };
	for (const item of sideItems) {
		const side = item.component.side ?? "left";
		item.x = side === "left" ? sideX.left : sideX.right - item.width;
		if (side === "left") sideX = { ...sideX, left: sideX.left + item.width };
		else sideX = { ...sideX, right: sideX.right - item.width };
		item.y = top;
		item.height = bodyHeight;
	}
	let footerTop = height - footerHeight;
	for (const item of footerItems) {
		item.x = 0;
		item.y = footerTop;
		footerTop += item.height;
	}
	let modalTop = Math.max(device.pad, Math.round((height - modalHeight) / 2));
	for (const item of modalItems) {
		item.x = Math.round((width - item.width) / 2);
		item.y = modalTop;
		modalTop += item.height + device.gap;
	}
	height = Math.max(height, modalTop - device.gap + device.pad);
	// Screen order: header, body, sidebars, footer, then modals over all of them.
	laid.push(...bodyItems, ...sideItems, ...footerItems, ...modalItems);
	const backdrop = headers.length + footers.length + body.length + sidebars.length > 0;
	return {
		screen,
		width,
		height,
		widened: width > device.width,
		laid,
		scrim: modalItems.length > 0 && backdrop,
		modals: new Set(modalItems.map((item) => item.path)),
	};
}

/**
 * Screens in rows that read left to right, as many to a row as keeps the
 * sheet within MAX_ASPECT, then balanced over those rows: four desktop
 * screens sit two by two rather than three over one.
 */
function arrangeScreens(placed: readonly PlacedScreen[]): { x: number; y: number }[] {
	const arrangement = (perRow: number) => {
		const origins: { x: number; y: number }[] = [];
		let y = 0;
		let widest = 0;
		for (let start = 0; start < placed.length; start += perRow) {
			const row = placed.slice(start, start + perRow);
			let x = 0;
			for (const screen of row) {
				origins.push({ x, y });
				x += screen.width + SCREEN_GAP_X;
			}
			widest = Math.max(widest, x - SCREEN_GAP_X);
			y += Math.max(...row.map((screen) => screen.height)) + SCREEN_GAP_Y;
		}
		return { origins, aspect: widest / Math.max(1, y - SCREEN_GAP_Y) };
	};
	let perRow = placed.length;
	while (perRow > 1 && arrangement(perRow).aspect > MAX_ASPECT) perRow -= 1;
	const rows = Math.ceil(placed.length / perRow);
	return arrangement(Math.ceil(placed.length / rows)).origins;
}

/** A control that opens another screen, before its arrow is routed. */
interface NavigationSource {
	readonly screen: string;
	readonly path: string;
	readonly target: string;
	/** The shape the arrow binds to: a button's box, or the box behind a link. */
	readonly nodeId: string;
	readonly box: Box;
	/** The containers around it, which its arrow may cross on the way out. */
	readonly ancestors: ReadonlySet<string>;
}

interface Painted {
	readonly elements: SceneElement[];
	readonly components: WireframeLayoutComponent[];
	readonly navigations: NavigationSource[];
}

function paintScreen(placed: PlacedScreen, origin: { x: number; y: number }): Painted {
	const { screen } = placed;
	const frameId = `frame:${screen.id}`;
	const elements: SceneElement[] = [];
	const components: WireframeLayoutComponent[] = [];
	const navigations: NavigationSource[] = [];
	const visit = (
		item: Laid,
		parentX: number,
		parentY: number,
		groups: string[],
		parent: string | undefined,
		overlay: boolean,
		opacity: number | undefined,
		ancestors: readonly string[] = [],
	) => {
		const box: Box = {
			x: parentX + item.x,
			y: parentY + item.y,
			width: item.width,
			height: item.height,
		};
		const group = `group:${screen.id}:${item.path}`;
		const container = isWireframeContainer(item.component);
		const own = !container || GROUPING.has(item.component.type) ? [group, ...groups] : groups;
		const faded = item.component.disabled === true ? 50 : opacity;
		const scope: Scope = {
			groupIds: own,
			frameId,
			...(faded === undefined ? {} : { opacity: faded }),
		};
		const id = `wf:${screen.id}:${item.path}`;
		const { target } = item.component;
		const opens =
			target !== undefined && (item.component.type === "button" || item.component.type === "link");
		// A link has no shape of its own for its arrow to bind to; an invisible box behind its words is one.
		if (opens && item.component.type === "link")
			elements.push({
				...shape(
					`${id}:hit`,
					"link-target",
					box,
					WIDGET,
					{ fill: WHITE, stroke: WHITE },
					item.component.text ?? "Link",
					scope,
				),
				opacity: 0,
			});
		elements.push(...item.paint(box, scope, id));
		if (opens)
			navigations.push({
				screen: screen.id,
				path: item.path,
				target,
				nodeId: item.component.type === "link" ? `${id}:hit` : `${id}:box`,
				box,
				ancestors: new Set(ancestors),
			});
		components.push({
			path: item.path,
			type: item.component.type,
			box,
			parent,
			...(item.flow ? { flow: item.flow } : {}),
			overlay,
			group,
		});
		for (const child of item.children)
			visit(
				child,
				box.x,
				box.y,
				container && GROUPING.has(item.component.type) ? own : groups,
				item.path,
				overlay,
				faded,
				[...ancestors, item.path],
			);
	};
	for (const item of placed.laid) {
		const overlay = placed.modals.has(item.path);
		if (
			overlay &&
			placed.scrim &&
			!elements.some((element) => element.id === `wf:${screen.id}:scrim`)
		)
			elements.push({
				...shape(
					`wf:${screen.id}:scrim`,
					"scrim",
					{ x: origin.x, y: origin.y, width: placed.width, height: placed.height },
					REGION,
					{ fill: SCRIM, stroke: SCRIM },
					"Backdrop",
					{ groupIds: [], frameId },
				),
				opacity: 30,
			});
		visit(item, origin.x, origin.y, [], undefined, overlay, undefined);
	}
	return { elements, components, navigations };
}

function placeScreens(diagram: WireframeDiagram) {
	const placed = diagram.screens.map(layoutScreen);
	const origins = arrangeScreens(placed);
	const frames: FrameSceneElement[] = placed.map((screen, index) => ({
		type: "frame",
		id: `frame:${screen.screen.id}`,
		name: wireframeFrameName(screen.screen.name),
		x: origins[index]!.x,
		y: origins[index]!.y,
		width: screen.width,
		height: screen.height,
	}));
	return { placed, origins, frames };
}

const offsetElement = (element: SceneElement, dx: number, dy: number): SceneElement =>
	element.type === "line" || element.type === "arrow"
		? ({
				...element,
				points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
			} as SceneElement)
		: { ...element, x: element.x + dx, y: element.y + dy };

function renderWithLayout(input: WireframeDiagram): {
	scene: RenderedDiagramScene;
	layout: WireframeLayout;
} {
	const diagram = validateWireframeDiagram(input);
	const { placed, origins, frames: placedFrames } = placeScreens(diagram);
	const painted = placed.map((screen, index) => paintScreen(screen, origins[index]!));
	const navigations = painted.flatMap((screen) => screen.navigations);
	// A screen a control opens carries a node id its arrow binds to.
	const opened = new Set(navigations.map((navigation) => navigation.target));
	const frames = placedFrames.map((frame, index) => {
		const id = placed[index]!.screen.id;
		return opened.has(id) ? { ...frame, nodeId: wireframeScreenNodeId(id) } : frame;
	});
	const arrows = navigationArrows(navigations, frames, painted);
	const nameBoxes = frames.map((frame) => canvasFrameNameBox(frame));
	const points = arrows.flatMap((arrow) => arrow.points);
	const left = Math.min(...frames.map((frame) => frame.x), ...points.map((point) => point.x));
	const top = Math.min(...nameBoxes.map((box) => box.y), ...points.map((point) => point.y));
	const dx = PADDING - left;
	const dy = PADDING - top;
	const elements: SceneElement[] = [
		...frames.map((frame) => offsetElement(frame, dx, dy)),
		...painted.flatMap((screen) =>
			screen.elements.map((element) => offsetElement(element, dx, dy)),
		),
		...arrows.map((arrow) => offsetElement(arrow, dx, dy)),
	];
	const right = Math.max(
		...frames.map((frame) => frame.x + frame.width),
		...points.map((point) => point.x),
	);
	const bottom = Math.max(
		...frames.map((frame) => frame.y + frame.height),
		...points.map((point) => point.y),
	);
	const scene: RenderedDiagramScene = {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: Math.ceil(right + dx + PADDING),
		height: Math.ceil(bottom + dy + PADDING),
		accentColor: diagram.style.accentColor,
		backgroundColor: diagram.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
	};
	const shift = (box: Box): Box => ({ ...box, x: box.x + dx, y: box.y + dy });
	const routed = new Set(arrows.map((arrow) => arrow.id));
	const layout: WireframeLayout = {
		screens: placed.map((screen, index) => ({
			id: screen.screen.id,
			device: screen.screen.device,
			frame: shift(frames[index]!),
			widened: screen.widened,
			components: painted[index]!.components.map((component) => ({
				...component,
				box: shift(component.box),
			})),
		})),
		navigations: navigations.map((navigation) => ({
			screen: navigation.screen,
			path: navigation.path,
			target: navigation.target,
			routed: routed.has(wireframeNavigationId(navigation.screen, navigation.path)),
		})),
	};
	return { scene, layout };
}

/** The node id a screen's frame binds the arrows of the controls that open it with. */
export const wireframeScreenNodeId = (screen: string) => `screen:${screen}`;
/** The id of the arrow from the control at `path` on `screen`. */
export const wireframeNavigationId = (screen: string, path: string) => `nav:${screen}:${path}`;

/** The box a text element is stored with, centered on its point. */
function textBox(text: TextSceneElement): NavigationBox {
	const width = Math.max(
		1,
		Math.min(text.maxWidth ?? 160, Math.ceil(estimateTextWidth(text.text, text.fontSize))),
	);
	const height = textHeight(text.text.split("\n").length, text.fontSize);
	return { x: text.x - width / 2, y: text.y - height / 2, width, height };
}

/**
 * One arrow per control that opens a screen, from its side to the screen's
 * frame, clear of every other screen and name and of everything on its own
 * screen but the containers around it. A control no route reaches draws none.
 */
function navigationArrows(
	navigations: readonly NavigationSource[],
	frames: readonly FrameSceneElement[],
	painted: readonly Painted[],
): ArrowSceneElement[] {
	if (navigations.length === 0) return [];
	const frameOf = new Map(frames.map((frame) => [frame.id, frame]));
	const nameBoxes = frames.map((frame) => canvasFrameNameBox(frame));
	const all = [...frames, ...nameBoxes];
	const area = {
		x: Math.min(...all.map((box) => box.x)) - 64,
		y: Math.min(...all.map((box) => box.y)) - 64,
		width:
			Math.max(...all.map((box) => box.x + box.width)) - Math.min(...all.map((box) => box.x)) + 128,
		height:
			Math.max(...all.map((box) => box.y + box.height)) -
			Math.min(...all.map((box) => box.y)) +
			128,
	};
	const screens = new Map(painted.map((screen, index) => [frames[index]!.id, screen]));
	const requests = navigations.map((navigation) => {
		const source = frameOf.get(`frame:${navigation.screen}`)!;
		const target = frameOf.get(`frame:${navigation.target}`)!;
		const own = screens.get(source.id)!;
		const prefix = `wf:${navigation.screen}:${navigation.path}:`;
		// A control on a modal runs over what the modal's backdrop dims.
		const overlay =
			own.components.find((component) => component.path === navigation.path)?.overlay === true;
		const scrim = own.elements.findIndex(
			(element) => element.type === "node" && element.kind === "wireframe:scrim",
		);
		return {
			source: navigation.box,
			target,
			obstacles: [
				...frames.filter((frame) => frame !== source && frame !== target),
				...nameBoxes,
				...own.components
					.filter(
						(component) =>
							component.path !== navigation.path &&
							!navigation.ancestors.has(component.path) &&
							!component.path.startsWith(`${navigation.path}.`) &&
							(!overlay || component.overlay),
					)
					.map((component) => component.box),
				...own.elements.flatMap((element, at) =>
					element.type === "text" &&
					!element.id.startsWith(prefix) &&
					!element.containerId &&
					(!overlay || at > scrim)
						? [textBox(element)]
						: [],
				),
			],
		};
	});
	const routes = routeNavigations(requests, area);
	return navigations.flatMap((navigation, index): ArrowSceneElement[] => {
		const points = routes[index];
		if (!points || points.length < 2) return [];
		const id = wireframeNavigationId(navigation.screen, navigation.path);
		return [
			{
				type: "arrow",
				id,
				edgeId: id,
				sourceNodeId: navigation.nodeId,
				targetNodeId: wireframeScreenNodeId(navigation.target),
				points: points as [ScenePoint, ...ScenePoint[]],
				startArrowhead: null,
				endArrowhead: "arrow",
				strokeColor: STROKE,
				strokeWidth: 2,
			},
		];
	});
}

/** A frame's name runs on one line, so an authored line break there reads as a space. */
export function wireframeFrameName(name: string): string {
	return name.replace(/\s*\n\s*/gu, " ");
}

/** Render a wireframe: each screen a frame, each component a group the renderer places. */
export function renderWireframeDiagram(input: WireframeDiagram): RenderedDiagramScene {
	return renderWithLayout(input).scene;
}

/** The boxes a wireframe renders with, in scene coordinates, for checks that read its layout. */
export function layoutWireframeDiagram(input: WireframeDiagram): WireframeLayout {
	return renderWithLayout(input).layout;
}
