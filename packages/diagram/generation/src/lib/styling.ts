import {
	DIAGRAM_NODE_COLORS,
	type DiagramNodeColor,
	flowchartNodeDetails,
	resolveFlowchartReference,
	type FlowchartDocument,
} from "@sketchi/diagram-core";
import { Result, Schema } from "effect";

import { isUnknownRecord } from "./unknown-record.js";

/** Node shapes a style may set, as the patch step draws them. */
export const DIAGRAM_STYLE_SHAPES = ["rectangle", "diamond", "ellipse", "circle"] as const;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/u));

/**
 * One styling request the model returns beside its diagram: the elements it targets, by id or
 * label, and what to change on them. The host applies it as a patch after the build.
 */
export class DiagramStyle extends Schema.Class<DiagramStyle>("DiagramStyle")({
	targets: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
	fillColor: Schema.optionalKey(HexColor),
	strokeColor: Schema.optionalKey(HexColor),
	textColor: Schema.optionalKey(HexColor),
	shape: Schema.optionalKey(Schema.Literals(DIAGRAM_STYLE_SHAPES)),
}) {}

/** Words that ask for a color or a shape; only a request that uses one gets the styling rules. */
const STYLE_WORDS =
	/#[0-9a-f]{6}\b|\b(?:red|green|blue|yellow|orange|purple|violet|pink|gr[ae]y|black|white|teal|cyan|magenta|brown|gold|navy|colou?r(?:ed|s)?|highlight(?:ed)?|diamond|circle|ellipse|oval|rectangle)\b/iu;

/** Whether a request asks for colors or shapes, so its prompt carries the styling rules. */
export function asksForStyling(request: string): boolean {
	return STYLE_WORDS.test(request);
}

/**
 * Read the styles a response carries, dropping each malformed entry with a diagnostic so a stray
 * style never fails the diagram.
 */
export function generatedStyles(raw: unknown, diagnostics: string[]): DiagramStyle[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		diagnostics.push("style_dropped: styles must be an array; the diagram draws unstyled.");
		return [];
	}
	return raw.flatMap((entry, index) => {
		const normalized = isUnknownRecord(entry)
			? {
					...entry,
					...(typeof entry["shape"] === "string" ? { shape: entry["shape"].toLowerCase() } : {}),
				}
			: entry;
		const decoded = Schema.decodeUnknownResult(DiagramStyle)(normalized);
		if (Result.isSuccess(decoded)) {
			const style = decoded.success;
			if (style.fillColor || style.strokeColor || style.textColor || style.shape) return [style];
		}
		diagnostics.push(
			`style_dropped: styles.${String(index)} needs targets and a #rrggbb color or a ${DIAGRAM_STYLE_SHAPES.join(", ")} shape; it is not applied.`,
		);
		return [];
	});
}

const hexRgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** The palette color a #rrggbb names: its stroke or tint exactly, else the nearest stroke. */
function paletteColor(hex: string): DiagramNodeColor {
	const wanted = hex.toLowerCase();
	const entries = Object.entries(DIAGRAM_NODE_COLORS) as [
		DiagramNodeColor,
		{ readonly stroke: string; readonly fill: string },
	][];
	const exact = entries.find(([, { stroke, fill }]) => stroke === wanted || fill === wanted);
	if (exact) return exact[0];
	const [r, g, b] = hexRgb(wanted);
	const distance = (stroke: string) => {
		const [sr, sg, sb] = hexRgb(stroke);
		return ((r ?? 0) - (sr ?? 0)) ** 2 + ((g ?? 0) - (sg ?? 0)) ** 2 + ((b ?? 0) - (sb ?? 0)) ** 2;
	};
	return entries.reduce((best, entry) =>
		distance(entry[1].stroke) < distance(best[1].stroke) ? entry : best,
	)[0];
}

/**
 * A flowchart's styles moved into its document where the document holds them: a node's color
 * becomes its palette color, and a diamond its shape. What remains (edges, text colors, other
 * shapes) stays a style.
 */
export function flowchartStylesAsNodeColors(
	document: FlowchartDocument,
	styles: readonly DiagramStyle[],
): { readonly document: FlowchartDocument; readonly styles: DiagramStyle[] } {
	const declared = Object.entries(document.nodes).map(
		([id, node]) => [id, flowchartNodeDetails(node).label] as const,
	);
	const nodes: Record<string, FlowchartDocument["nodes"][string]> = { ...document.nodes };
	const rest: DiagramStyle[] = [];
	for (const style of styles) {
		const color = style.strokeColor ?? style.fillColor;
		const diamond = style.shape === "diamond";
		const kept: string[] = [];
		for (const target of style.targets) {
			const found = resolveFlowchartReference(target, declared);
			const current = found ? nodes[found.id] : undefined;
			if (!found || current === undefined || (!color && !diamond)) {
				kept.push(target);
				continue;
			}
			nodes[found.id] = {
				...flowchartNodeDetails(current),
				...(color ? { color: paletteColor(color) } : {}),
				...(diamond ? { shape: "diamond" as const } : {}),
			};
		}
		// The node targets keep what the document cannot hold: a text color or another shape.
		const moved = style.targets.filter((target) => !kept.includes(target));
		const leftover = {
			...(style.textColor ? { textColor: style.textColor } : {}),
			...(style.shape && !diamond ? { shape: style.shape } : {}),
		};
		if (kept.length > 0) rest.push(new DiagramStyle({ ...style, targets: kept }));
		if (moved.length > 0 && Object.keys(leftover).length > 0)
			rest.push(new DiagramStyle({ targets: moved, ...leftover }));
	}
	return { document: { ...document, nodes }, styles: rest };
}
