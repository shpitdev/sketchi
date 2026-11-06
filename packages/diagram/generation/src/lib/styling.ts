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
