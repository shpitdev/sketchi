import { type CodeModeIssue } from "../build/result.js";
import { cleanToolString } from "../clean-text.js";
import { isStructurallyValidChartMark } from "../families/chart/render.js";
import { isStructurallyValidClassBox } from "../families/class/render.js";
import {
	isStructurallyValidErOptional,
	isStructurallyValidErTable,
} from "../families/er/render.js";
import { isStructurallyValidGanttMark } from "../families/gantt/render.js";
import { isStructurallyValidJourneyMark } from "../families/journey/render.js";
import { isStructurallyValidQuadrantMark } from "../families/quadrant/render.js";
import { isStructurallyValidSankeyMark } from "../families/sankey/render.js";
import {
	isStructurallyValidSequenceActivation,
	isStructurallyValidSequenceLifeline,
} from "../families/sequence/render.js";
import { isStructurallyValidTimelineMarker } from "../families/timeline/render.js";
import { isStructurallyValidVennSet } from "../families/venn/render.js";
import { isStructurallyValidStateMarker } from "../graph/compose.js";

import {
	CANVAS_LIMITS,
	isDrawnIconSlug,
	isIconRecipe,
	withoutCanvasElements,
	type CanvasIconAsset,
	type CanvasPoint as ScenePoint,
	type CanvasSpec,
	type IconRecipe,
} from "@sketchi/drawing";
import { type validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect } from "effect";

import { jsonSizeBytes } from "../build/code-mode/artifacts.js";
import { exportIssues } from "../build/code-mode/export.js";
import { iconRefSlug, undrawableIconIssue } from "../build/code-mode/icons.js";
import { issue } from "../build/code-mode/issues.js";
import { type CanvasInput } from "./input.js";

export function canvasExportIssues(
	validationIssues: ReturnType<typeof validateExcalidrawScene>["issues"],
): CodeModeIssue[] {
	return exportIssues(
		// Canvas authoring permits intentional overlaps and connector crossings;
		// these quality diagnostics are not hard structural export failures.
		validationIssues.filter(
			(validationIssue) =>
				validationIssue.code !== "overlapping-arrow-segment" &&
				validationIssue.code !== "arrow-segment-through-node",
		),
	);
}

/**
 * A canvas icon's slug: its own, or its drawn icon's under the recipe's drawn
 * slug, recorded in `drawn`; none when it names no slug and carries no
 * drawable recipe (undrawableCanvasIconIssues reports those).
 */
function canvasIconSlug(
	ref: { readonly slug?: string; readonly name?: string; readonly recipe?: unknown },
	drawn: Map<string, CanvasIconAsset>,
): string | undefined {
	const found = iconRefSlug(ref);
	if ("problem" in found) return undefined;
	if (ref.recipe !== undefined && !drawn.has(found.slug)) {
		const name = ref.name ? cleanToolString(ref.name) : "";
		drawn.set(found.slug, { name: name || "Drawn icon", recipe: ref.recipe as IconRecipe });
	}
	return found.slug;
}

/** Warnings for canvas icons that name no slug and carry no drawable recipe. */
export function undrawableCanvasIconIssues(scene: CanvasInput): CodeModeIssue[] {
	return scene.elements.flatMap((element, index) => {
		const ref = element.type === "icon" ? element : "icon" in element ? element.icon : undefined;
		if (!ref) return [];
		const found = iconRefSlug(ref);
		if (!("problem" in found)) return [];
		const owner = element.type === "icon" ? "icon element" : element.type;
		return [
			{
				...undrawableIconIssue({
					owner,
					id: element.id,
					path: element.type === "icon" ? `elements[${index}]` : `elements[${index}].icon`,
					problem: found.problem,
				}),
				ref: {
					kind: "element" as const,
					id: element.id,
					path: element.type === "icon" ? `elements[${index}]` : `elements[${index}].icon`,
				},
			},
		];
	});
}

/** The drawable scene an authored canvas describes, or null when a point list is malformed. */
export function normalizeCanvasInput(scene: CanvasInput): CanvasSpec | null {
	const elements: Array<CanvasSpec["elements"][number]> = [];
	const removed = new Set<string>();
	// A scene's drawn icons draw only from the recipes it carries, so they travel with it.
	const drawn = new Map<string, CanvasIconAsset>(
		Object.entries(scene.icons ?? {}).flatMap(([slug, asset]) =>
			isDrawnIconSlug(slug) && asset.recipe && isIconRecipe(asset.recipe)
				? [[slug, { name: asset.name, recipe: asset.recipe }] as const]
				: [],
		),
	);

	for (const element of scene.elements) {
		if (element.type === "arrow") {
			const first = element.points[0];
			const second = element.points[1];
			const rest = element.points.slice(2);
			if (!first || !second) {
				return null;
			}
			const points: [ScenePoint, ScenePoint, ...ScenePoint[]] = [first, second, ...rest];
			elements.push({
				...element,
				type: "arrow",
				id: element.id,
				edgeId: element.edgeId,
				sourceNodeId: element.sourceNodeId,
				targetNodeId: element.targetNodeId,
				...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
				...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
				...(element.textColor ? { textColor: element.textColor } : {}),
				points,
				...(element.label ? { label: element.label } : {}),
			});
			continue;
		}

		if (element.type === "node") {
			const polygonPoints = element.points;
			if (
				element.shape === "polygon" &&
				(!polygonPoints || !polygonPoints[0] || !polygonPoints[1] || !polygonPoints[2])
			) {
				return null;
			}
			const iconSlug = element.icon ? canvasIconSlug(element.icon, drawn) : undefined;
			elements.push({
				type: "node",
				id: element.id,
				nodeId: element.nodeId,
				...(element.kind ? { kind: element.kind } : {}),
				...(element.icon && iconSlug
					? {
							icon: {
								slug: iconSlug,
								size: element.icon.size,
								...(element.icon.exact ? { exact: true } : {}),
							},
						}
					: {}),
				shape: element.shape,
				...(element.fillColor ? { fillColor: element.fillColor } : {}),
				...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
				x: element.x,
				y: element.y,
				width: element.width,
				height: element.height,
				label: element.label,
				...(element.frameId ? { frameId: element.frameId } : {}),
				...(element.groupIds ? { groupIds: [...element.groupIds] } : {}),
				...(element.layerId ? { layerId: element.layerId } : {}),
				...(element.locked !== undefined ? { locked: element.locked } : {}),
				...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
				...(element.zIndex !== undefined ? { zIndex: element.zIndex } : {}),
				...(element.fillStyle ? { fillStyle: element.fillStyle } : {}),
				...(element.roughness !== undefined ? { roughness: element.roughness } : {}),
				...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
				...(element.strokeWidth !== undefined ? { strokeWidth: element.strokeWidth } : {}),
				...((element.rendererRole === "sequence-lifeline" &&
					isStructurallyValidSequenceLifeline(scene, element)) ||
				(element.rendererRole === "sequence-activation" &&
					isStructurallyValidSequenceActivation(scene, element)) ||
				(element.rendererRole === "timeline-marker" &&
					isStructurallyValidTimelineMarker(element)) ||
				(element.rendererRole === "chart-mark" && isStructurallyValidChartMark(element)) ||
				(element.rendererRole === "journey-mark" && isStructurallyValidJourneyMark(element)) ||
				(element.rendererRole === "quadrant-mark" && isStructurallyValidQuadrantMark(element)) ||
				(element.rendererRole === "gantt-mark" && isStructurallyValidGanttMark(element)) ||
				(element.rendererRole === "state-marker" && isStructurallyValidStateMarker(element)) ||
				(element.rendererRole === "er-table" && isStructurallyValidErTable(element)) ||
				(element.rendererRole === "er-optional" && isStructurallyValidErOptional(element)) ||
				(element.rendererRole === "class-box" && isStructurallyValidClassBox(element)) ||
				(element.rendererRole === "venn-set" && isStructurallyValidVennSet(element)) ||
				(element.rendererRole === "sankey-mark" && isStructurallyValidSankeyMark(element)) ||
				((element.rendererRole === "swimlane" || element.rendererRole === "swimlane-header") &&
					element.shape === "rectangle" &&
					!element.icon) ||
				// A zone's logo sits in its header.
				(element.rendererRole === "zone" && element.shape === "rectangle") ||
				((element.rendererRole === "wireframe-widget" ||
					element.rendererRole === "wireframe-region") &&
					!element.icon)
					? { rendererRole: element.rendererRole }
					: {}),
				...(element.textColor ? { textColor: element.textColor } : {}),
				...(element.shape === "polygon" &&
				polygonPoints?.[0] &&
				polygonPoints[1] &&
				polygonPoints[2]
					? {
							points: [
								polygonPoints[0],
								polygonPoints[1],
								polygonPoints[2],
								...polygonPoints.slice(3),
							],
						}
					: {}),
			});
			continue;
		}

		if (element.type === "line") {
			const first = element.points[0];
			const second = element.points[1];
			if (!first || !second) return null;
			elements.push({
				...element,
				points: [first, second, ...element.points.slice(2)],
			});
			continue;
		}

		if (element.type === "frame") {
			const { icon, ...frame } = structuredClone(element);
			const iconSlug = icon ? canvasIconSlug(icon, drawn) : undefined;
			elements.push({
				...frame,
				...(icon && iconSlug
					? { icon: { slug: iconSlug, size: icon.size, ...(icon.exact ? { exact: true } : {}) } }
					: {}),
			});
			continue;
		}

		if (element.type === "icon") {
			const { slug: _slug, name: _name, recipe: _recipe, ...placed } = structuredClone(element);
			const slug = canvasIconSlug(element, drawn);
			if (slug) elements.push({ ...placed, slug });
			else removed.add(element.id);
			continue;
		}

		elements.push(structuredClone(element));
	}

	return withoutCanvasElements(
		{
			kind: scene.kind,
			version: scene.version,
			diagramId: scene.diagramId,
			title: scene.title,
			width: scene.width,
			height: scene.height,
			accentColor: scene.accentColor,
			backgroundColor: scene.backgroundColor,
			elements,
			...(drawn.size > 0 ? { icons: Object.fromEntries(drawn) } : {}),
			layers: structuredClone(scene.layers),
			layouts: structuredClone(scene.layouts),
			zOrder: [...scene.zOrder],
		},
		removed,
	);
}

/** A raw canvas that cannot serialize, or serializes past the limit, fails before decoding. */
export const serializedCanvasLimitIssue = Effect.fn("codeMode.canvas.serializedLimit")(
	(canvas: unknown, path: "spec" | "source.scene") =>
		Effect.try(() => jsonSizeBytes(canvas)).pipe(
			Effect.match({
				onFailure: () =>
					issue({
						code: "invalid_type",
						stage: "input",
						ref: { kind: "request", path },
						message: "CanvasSpec could not be serialized as JSON.",
						hint: "Remove non-JSON values or reduce deeply nested fields and retry.",
					}),
				onSuccess: (sizeBytes) =>
					sizeBytes <= CANVAS_LIMITS.maxSerializedBytes
						? undefined
						: issue({
								code: "canvas_limit_exceeded",
								stage: "canvas",
								ref: { kind: "request", path },
								message: `CanvasSpec exceeds ${CANVAS_LIMITS.maxSerializedBytes} serialized bytes.`,
								hint: "Split the visualization into a smaller canvas or reduce repeated text and points.",
							}),
			}),
		),
);
