import { Array as Arr } from "effect";
import { type CanvasValidationIssue } from "@sketchi/drawing";
import { type BuildIssue, type BuildIssueCode } from "./result";
function canvasIssueCode(validationIssue: CanvasValidationIssue): BuildIssueCode {
	switch (validationIssue.code) {
		case "duplicate_element_id":
			return "duplicate_element_id";
		case "duplicate_layer_id":
			return "duplicate_layer_id";
		case "empty_canvas":
			return "invalid_canvas_geometry";
		case "invalid_binding":
			return "invalid_canvas_binding";
		case "invalid_composition":
			return "invalid_canvas_composition";
		case "invalid_geometry":
			return "invalid_canvas_geometry";
		case "invalid_icon":
			return "invalid_canvas_icon";
		case "invalid_polygon":
			return "invalid_polygon";
		case "label_overflow":
			return "invalid_canvas_geometry";
		case "limit_exceeded":
			return "canvas_limit_exceeded";
		case "missing_z_order_element":
		case "duplicate_z_order_element":
		case "unknown_z_order_element":
			return "invalid_z_order";
		case "unknown_layout_target":
			return "unknown_layout_target";
	}
}
/** A scene over a canvas limit is too large rather than broken: the caller splits it. */
export function canvasFailureStatus(
	validationIssues: readonly CanvasValidationIssue[],
): "limit_exceeded" | "render_failed" {
	return Arr.some(validationIssues, (entry) => entry.code === "limit_exceeded")
		? "limit_exceeded"
		: "render_failed";
}
export function canvasValidationIssues(
	validationIssues: readonly CanvasValidationIssue[],
): BuildIssue[] {
	return Arr.map(Arr.take(validationIssues, 20), (validationIssue) => ({
		severity: "error" as const,
		code: canvasIssueCode(validationIssue),
		stage: "canvas",
		ref: validationIssue.elementId
			? {
					kind: "element",
					id: validationIssue.elementId,
					path: validationIssue.path,
				}
			: { kind: "diagram", path: validationIssue.path },
		message: validationIssue.message,
		hint: "Repair the referenced CanvasSpec field and call createCanvas again.",
	}));
}
