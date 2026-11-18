import { type BuildIssue } from "../build/result";

import { curvedConnectorBetween, wrappedLabelWidth, wrapTextToWidth } from "@sketchi/drawing";

import { issue } from "../build/issues";
import { type CanvasInput } from "./input";
import { type DiagramPatchOperation, type DiagramSelector } from "./patch-contract";

const SCENE_PADDING = 48;

type PatchableElement = CanvasInput["elements"][number];
type PatchableNode = Extract<PatchableElement, { type: "node" }>;
type PatchableText = Extract<PatchableElement, { type: "text" }>;
type PatchableArrow = Extract<PatchableElement, { type: "arrow" }>;
type PatchablePoint = PatchableArrow["points"][number];

interface SelectorTargets {
	arrows: PatchableArrow[];
	/** Standalone icon elements, which only a translate moves. */
	icons: Extract<CanvasInput["elements"][number], { type: "icon" }>[];
	nodes: PatchableNode[];
	texts: PatchableText[];
}

export function sourceConnectivity(scene: CanvasInput): string[] {
	return scene.elements
		.flatMap((element) => {
			if (element.type === "arrow") {
				return [`arrow:${element.id}:${element.sourceNodeId}->${element.targetNodeId}`];
			}
			if (element.type === "line") {
				return [
					`line:${element.id}:${element.startBinding?.elementId ?? ""}->${element.endBinding?.elementId ?? ""}`,
				];
			}
			return [];
		})
		.sort();
}

export function sameConnectivity(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function nodeElements(scene: CanvasInput): PatchableNode[] {
	return scene.elements.filter((element): element is PatchableNode => element.type === "node");
}

function textElements(scene: CanvasInput): PatchableText[] {
	return scene.elements.filter((element): element is PatchableText => element.type === "text");
}

function arrowElements(scene: CanvasInput): PatchableArrow[] {
	return scene.elements.filter((element): element is PatchableArrow => element.type === "arrow");
}

function labelsMatch(labels: readonly string[] | undefined, value: string | undefined): boolean {
	if (!labels || labels.length === 0 || !value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return labels.some((label) => label.trim().toLowerCase() === normalized);
}

function selectorHasFilters(selector: DiagramSelector | undefined): boolean {
	return Boolean(
		selector &&
		((selector.ids?.length ?? 0) > 0 ||
			(selector.nodeIds?.length ?? 0) > 0 ||
			(selector.edgeIds?.length ?? 0) > 0 ||
			(selector.kinds?.length ?? 0) > 0 ||
			(selector.labels?.length ?? 0) > 0),
	);
}

function resolveTargets(
	scene: CanvasInput,
	selector: DiagramSelector | undefined,
): SelectorTargets {
	const scope = selector?.scope ?? "all";
	const hasFilters = selectorHasFilters(selector);
	const ids = new Set(selector?.ids ?? []);
	const nodeIds = new Set(selector?.nodeIds ?? []);
	const edgeIds = new Set(selector?.edgeIds ?? []);
	const kinds = new Set(selector?.kinds ?? []);
	const nodes = nodeElements(scene).filter((node) => {
		if (scope === "edges") {
			return false;
		}
		if (!selector || !hasFilters) {
			return true;
		}
		return (
			ids.has(node.id) ||
			nodeIds.has(node.nodeId) ||
			(node.kind ? [...kinds].some((kind) => kind === node.kind) : false) ||
			labelsMatch(selector.labels, node.label)
		);
	});
	const arrows = arrowElements(scene).filter((arrow) => {
		if (scope === "nodes") {
			return false;
		}
		if (!selector || !hasFilters) {
			return true;
		}
		return (
			ids.has(arrow.id) || edgeIds.has(arrow.edgeId) || labelsMatch(selector.labels, arrow.label)
		);
	});
	const nodeElementIds = new Set(nodes.map((node) => node.id));
	const arrowElementIds = new Set(arrows.map((arrow) => arrow.id));
	const texts = textElements(scene).filter((text) => {
		if (!selector || !hasFilters) {
			if (scope === "nodes") {
				return text.containerId ? nodeElementIds.has(text.containerId) : false;
			}
			if (scope === "edges") {
				return text.containerId ? arrowElementIds.has(text.containerId) : false;
			}
			return true;
		}
		return (
			ids.has(text.id) ||
			(text.containerId ? nodeElementIds.has(text.containerId) : false) ||
			(text.containerId ? arrowElementIds.has(text.containerId) : false) ||
			labelsMatch(selector.labels, text.text)
		);
	});

	const icons = scene.elements.filter(
		(element): element is SelectorTargets["icons"][number] =>
			element.type === "icon" &&
			scope === "all" &&
			(!selector || !hasFilters || ids.has(element.id)),
	);

	return { arrows, icons, nodes, texts };
}

function targetIssue(operation: DiagramPatchOperation): BuildIssue {
	return issue({
		code: "unknown_patch_target",
		stage: "flowchart",
		ref: { kind: "request", path: "operations.selector" },
		message: `Patch operation "${operation.op}" did not match any scene element.`,
		hint: "Use nodeIds, edgeIds, ids, kinds, labels, or scope values that exist in the accepted artifact.",
	});
}

function textForContainer(scene: CanvasInput, containerId: string): PatchableText | undefined {
	return textElements(scene).find(
		(text) => text.containerId === containerId || text.id === `${containerId}:label`,
	);
}

function centerTextOnNode(scene: CanvasInput, node: PatchableNode): void {
	const text = textForContainer(scene, node.id);
	if (!text) {
		return;
	}
	text.x = node.x + node.width / 2;
	text.y = node.y + node.height / 2;
}

function midpoint(points: readonly PatchablePoint[]): PatchablePoint | undefined {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) {
		return undefined;
	}
	return {
		x: (first.x + last.x) / 2,
		y: (first.y + last.y) / 2 - 10,
	};
}

function syncArrowLabel(scene: CanvasInput, arrow: PatchableArrow): void {
	const label = textForContainer(scene, arrow.id);
	const point = midpoint(arrow.points);
	if (label && !label.containerId) {
		const start = arrow.points[0];
		if (!start) return;
		const next = arrow.points.find((point) => point.x !== start.x || point.y !== start.y);
		if (!next) return;
		const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize);
		const width = wrappedLabelWidth(text, label.fontSize, label.maxWidth ?? 160);
		const height = Math.ceil(text.split("\n").length * label.fontSize * 1.35);
		label.x = (start.x + next.x) / 2 + (start.x === next.x ? width / 2 + 8 : 0);
		label.y = (start.y + next.y) / 2 - (start.y === next.y ? height / 2 + 5 : 0);
		return;
	}
	if (!label || !point) {
		return;
	}
	label.x = point.x;
	label.y = point.y;
}

function translatePoint(point: PatchablePoint, dx: number, dy: number): PatchablePoint {
	return { x: point.x + dx, y: point.y + dy };
}

function applyStyle(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "setDefaultStyle" | "setStyle" }>,
): BuildIssue[] {
	if (operation.style.backgroundColor) {
		scene.backgroundColor = operation.style.backgroundColor;
	}

	if (operation.op === "setDefaultStyle") {
		if (operation.style.strokeColor) {
			scene.accentColor = operation.style.strokeColor;
		}
		for (const node of nodeElements(scene)) {
			if (operation.style.fillColor) {
				node.fillColor = operation.style.fillColor;
			}
			if (operation.style.strokeColor) {
				node.strokeColor = operation.style.strokeColor;
			}
			if (operation.style.textColor) {
				node.textColor = operation.style.textColor;
			}
		}
		for (const arrow of arrowElements(scene)) {
			if (operation.style.strokeColor) {
				arrow.strokeColor = operation.style.strokeColor;
			}
			if (operation.style.textColor) {
				arrow.textColor = operation.style.textColor;
			}
		}
		for (const text of textElements(scene)) {
			if (operation.style.textColor) {
				text.textColor = operation.style.textColor;
			}
		}
		return [];
	}

	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0 && targets.arrows.length === 0 && targets.texts.length === 0) {
		return [targetIssue(operation)];
	}

	for (const node of targets.nodes) {
		if (operation.style.fillColor) {
			node.fillColor = operation.style.fillColor;
		}
		if (operation.style.strokeColor) {
			node.strokeColor = operation.style.strokeColor;
		}
		if (operation.style.textColor) {
			node.textColor = operation.style.textColor;
			const text = textForContainer(scene, node.id);
			if (text) {
				text.textColor = operation.style.textColor;
			}
		}
	}
	for (const arrow of targets.arrows) {
		if (operation.style.strokeColor) {
			arrow.strokeColor = operation.style.strokeColor;
		}
		if (operation.style.textColor) {
			arrow.textColor = operation.style.textColor;
			const text = textForContainer(scene, arrow.id);
			if (text) {
				text.textColor = operation.style.textColor;
			}
		}
	}
	for (const text of targets.texts) {
		if (operation.style.textColor) {
			text.textColor = operation.style.textColor;
		}
	}

	return [];
}

function rerouteConnectedArrows(scene: CanvasInput, nodeIds: readonly string[]): void {
	const movedNodeIds = new Set(nodeIds);
	for (const arrow of arrowElements(scene)) {
		if (movedNodeIds.has(arrow.sourceNodeId) || movedNodeIds.has(arrow.targetNodeId)) {
			rerouteArrow(scene, arrow);
		}
	}
}

function applyShape(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "setShape" }>,
): BuildIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0) {
		return [targetIssue(operation)];
	}

	const resizedNodeIds: string[] = [];
	for (const node of targets.nodes) {
		node.shape = operation.shape;
		if (operation.shape === "polygon") {
			node.points = [
				{ x: node.width / 2, y: 0 },
				{ x: node.width, y: node.height / 2 },
				{ x: node.width / 2, y: node.height },
				{ x: 0, y: node.height / 2 },
			];
		} else {
			delete node.points;
		}
		if (operation.shape === "circle") {
			const size = Math.max(node.width, node.height);
			node.x -= (size - node.width) / 2;
			node.y -= (size - node.height) / 2;
			node.width = size;
			node.height = size;
			resizedNodeIds.push(node.nodeId);
		}
		centerTextOnNode(scene, node);
	}
	rerouteConnectedArrows(scene, resizedNodeIds);
	return [];
}

function applyTranslate(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "translate" }>,
): BuildIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (
		targets.nodes.length === 0 &&
		targets.arrows.length === 0 &&
		targets.texts.length === 0 &&
		targets.icons.length === 0
	) {
		return [targetIssue(operation)];
	}

	for (const icon of targets.icons) {
		icon.x += operation.dx;
		icon.y += operation.dy;
	}

	const movedNodeIds = new Set<string>();
	const movedTextIds = new Set<string>();

	for (const node of targets.nodes) {
		node.x += operation.dx;
		node.y += operation.dy;
		movedNodeIds.add(node.nodeId);
		const text = textForContainer(scene, node.id);
		if (text) {
			text.x += operation.dx;
			text.y += operation.dy;
			movedTextIds.add(text.id);
		}
	}

	for (const arrow of targets.arrows) {
		arrow.points = arrow.points.map((point) => translatePoint(point, operation.dx, operation.dy));
		const label = textForContainer(scene, arrow.id);
		if (label) {
			label.x += operation.dx;
			label.y += operation.dy;
			movedTextIds.add(label.id);
		}
	}

	for (const text of targets.texts) {
		if (!movedTextIds.has(text.id)) {
			text.x += operation.dx;
			text.y += operation.dy;
		}
	}

	rerouteConnectedArrows(scene, [...movedNodeIds]);
	recomputeSceneBounds(scene);
	return [];
}

function applyReplaceText(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "replaceText" }>,
): BuildIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0 && targets.arrows.length === 0 && targets.texts.length === 0) {
		return [targetIssue(operation)];
	}

	for (const node of targets.nodes) {
		node.label = operation.text;
		const text = textForContainer(scene, node.id);
		if (text) {
			text.text = operation.text;
		}
	}
	for (const arrow of targets.arrows) {
		arrow.label = operation.text;
		const text = textForContainer(scene, arrow.id);
		if (text) {
			text.text = operation.text;
		}
	}
	for (const text of targets.texts) {
		text.text = operation.text;
	}

	return [];
}

function nodeCenter(node: PatchableNode): PatchablePoint {
	return {
		x: node.x + node.width / 2,
		y: node.y + node.height / 2,
	};
}

function edgePoint(
	source: PatchableNode,
	target: PatchableNode,
	coincidentRole: "source" | "target",
): PatchablePoint {
	const sourceCenter = nodeCenter(source);
	const targetCenter = nodeCenter(target);
	const dx = targetCenter.x - sourceCenter.x;
	const dy = targetCenter.y - sourceCenter.y;

	// Opposite faces prevent a route between coincident centers from collapsing.
	if (dx === 0 && dy === 0) {
		return {
			x: sourceCenter.x,
			y: coincidentRole === "source" ? source.y + source.height : source.y,
		};
	}

	if (Math.abs(dx) > Math.abs(dy)) {
		if (dx >= 0) {
			return { x: source.x + source.width, y: sourceCenter.y };
		}
		return { x: source.x, y: sourceCenter.y };
	}

	if (dy >= 0) {
		return { x: sourceCenter.x, y: source.y + source.height };
	}
	return { x: sourceCenter.x, y: source.y };
}

function rerouteArrow(scene: CanvasInput, arrow: PatchableArrow): BuildIssue[] {
	const nodesById = new Map(nodeElements(scene).map((node) => [node.nodeId, node]));
	const source = nodesById.get(arrow.sourceNodeId);
	const target = nodesById.get(arrow.targetNodeId);
	if (!source || !target) {
		return [
			issue({
				code: "patch_output_invalid",
				stage: "render",
				ref: { kind: "edge", id: arrow.edgeId },
				message: `Arrow "${arrow.id}" references a node that is not in the scene.`,
				hint: "Rebuild the diagram with buildFlowchart or buildMindmap before applying visual patches.",
			}),
		];
	}

	// A curved connector, a mindmap branch, is redrawn as a curve, not an elbow.
	if (arrow.curved) {
		arrow.points = curvedConnectorBetween(source, target).map((point) => ({ ...point }));
		syncArrowLabel(scene, arrow);
		return [];
	}
	const start = edgePoint(source, target, "source");
	const end = edgePoint(target, source, "target");
	const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);
	if (vertical) {
		const midY = (start.y + end.y) / 2;
		arrow.points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
	} else {
		const midX = (start.x + end.x) / 2;
		arrow.points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
	}
	syncArrowLabel(scene, arrow);
	return [];
}

function applyRerouteEdges(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "rerouteEdges" }>,
): BuildIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.arrows.length === 0) {
		return [targetIssue(operation)];
	}
	return targets.arrows.flatMap((arrow) => rerouteArrow(scene, arrow));
}

function recomputeSceneBounds(scene: CanvasInput): void {
	let maxX = scene.width;
	let maxY = scene.height;
	for (const element of scene.elements) {
		if (element.type === "arrow" || element.type === "line") {
			for (const point of element.points) {
				maxX = Math.max(maxX, point.x);
				maxY = Math.max(maxY, point.y);
			}
		} else if (element.type === "text") {
			maxX = Math.max(maxX, element.x + (element.maxWidth ?? 0));
			maxY = Math.max(maxY, element.y + element.fontSize);
		} else {
			maxX = Math.max(maxX, element.x + element.width);
			maxY = Math.max(maxY, element.y + element.height);
		}
	}
	scene.width = maxX + SCENE_PADDING;
	scene.height = maxY + SCENE_PADDING;
}

function patchTargetIds(scene: CanvasInput, selector: DiagramSelector): Set<string> {
	const targets = resolveTargets(scene, selector);
	const ids = new Set([
		...targets.nodes.map((element) => element.id),
		...targets.arrows.map((element) => element.id),
		...targets.texts.map((element) => element.id),
	]);
	const explicitIds = new Set(selector.ids ?? []);
	for (const element of scene.elements) {
		if (explicitIds.has(element.id)) ids.add(element.id);
	}
	return ids;
}

function anchoredIndex(
	order: readonly string[],
	beforeId: string | undefined,
	afterId: string | undefined,
): number | undefined {
	if (beforeId && afterId) return undefined;
	if (beforeId) {
		const index = order.indexOf(beforeId);
		return index >= 0 ? index : undefined;
	}
	if (afterId) {
		const index = order.indexOf(afterId);
		return index >= 0 ? index + 1 : undefined;
	}
	return order.length;
}

function structuralOperationIssue(operation: DiagramPatchOperation, message: string): BuildIssue[] {
	return [
		issue({
			code: "patch_output_invalid",
			stage: "canvas",
			ref: { kind: "request", path: "operations" },
			message,
			hint: `Repair the ${operation.op} operation and preserve unique, stable element ids.`,
		}),
	];
}

function applyInsert(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "insert" }>,
): BuildIssue[] {
	const existingIds = new Set(scene.elements.map((element) => element.id));
	const insertedIds = operation.elements.map((element) => element.id);
	if (
		new Set(insertedIds).size !== insertedIds.length ||
		insertedIds.some((id) => existingIds.has(id))
	) {
		return structuralOperationIssue(
			operation,
			"Inserted elements must use ids that are unique within the canvas.",
		);
	}
	const index = anchoredIndex(scene.zOrder, operation.beforeId, operation.afterId);
	if (index === undefined) {
		return structuralOperationIssue(
			operation,
			"Insert specifies an unknown anchor or both beforeId and afterId.",
		);
	}
	scene.elements.push(...operation.elements.map((element) => structuredClone(element)));
	scene.zOrder.splice(index, 0, ...insertedIds);
	return [];
}

function applyRemove(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "remove" }>,
): BuildIssue[] {
	const removedIds = patchTargetIds(scene, operation.selector);
	if (removedIds.size === 0) return [targetIssue(operation)];
	const removedNodeIds = new Set(
		scene.elements.flatMap((element) =>
			element.type === "node" && removedIds.has(element.id) ? [element.nodeId] : [],
		),
	);
	let previousSize: number;
	do {
		previousSize = removedIds.size;
		for (const element of scene.elements) {
			if (
				(element.type === "text" &&
					((element.containerId && removedIds.has(element.containerId)) ||
						arrowElements(scene).some(
							(arrow) =>
								removedIds.has(arrow.id) && textForContainer(scene, arrow.id)?.id === element.id,
						))) ||
				(element.type === "arrow" &&
					(removedNodeIds.has(element.sourceNodeId) || removedNodeIds.has(element.targetNodeId))) ||
				(element.type === "line" &&
					((element.startBinding && removedIds.has(element.startBinding.elementId)) ||
						(element.endBinding && removedIds.has(element.endBinding.elementId))))
			) {
				removedIds.add(element.id);
			}
		}
	} while (removedIds.size !== previousSize);
	const retained = scene.elements
		.filter((element) => !removedIds.has(element.id))
		.map((element) => {
			if (element.frameId && removedIds.has(element.frameId)) {
				const { frameId: _removedFrameId, ...retainedElement } = element;
				return retainedElement;
			}
			return element;
		});
	scene.elements.splice(0, scene.elements.length, ...retained);
	const retainedOrder = scene.zOrder.filter((id) => !removedIds.has(id));
	scene.zOrder.splice(0, scene.zOrder.length, ...retainedOrder);
	const layouts = scene.layouts
		.map((layout) => ({
			...layout,
			ids: layout.ids.filter((id) => !removedIds.has(id)),
		}))
		.filter((layout) => layout.ids.length > 0);
	scene.layouts.splice(0, scene.layouts.length, ...layouts);
	recomputeSceneBounds(scene);
	return [];
}

function applyReplace(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "replace" }>,
): BuildIssue[] {
	const index = scene.elements.findIndex((element) => element.id === operation.id);
	if (index < 0) return [targetIssue(operation)];
	if (operation.element.id !== operation.id) {
		return structuralOperationIssue(
			operation,
			"Replacement element id must match the stable id being replaced.",
		);
	}
	scene.elements.splice(index, 1, structuredClone(operation.element));
	recomputeSceneBounds(scene);
	return [];
}

function applyReorder(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "reorder" }>,
): BuildIssue[] {
	const selected = new Set(operation.ids);
	if (
		selected.size !== operation.ids.length ||
		operation.ids.some((id) => !scene.zOrder.includes(id))
	) {
		return structuralOperationIssue(
			operation,
			"Reorder ids must be unique ids already present in zOrder.",
		);
	}
	const remaining = scene.zOrder.filter((id) => !selected.has(id));
	const index = anchoredIndex(remaining, operation.beforeId, operation.afterId);
	if (index === undefined) {
		return structuralOperationIssue(
			operation,
			"Reorder specifies an unknown anchor or both beforeId and afterId.",
		);
	}
	remaining.splice(index, 0, ...operation.ids);
	scene.zOrder.splice(0, scene.zOrder.length, ...remaining);
	return [];
}

function applyGroup(
	scene: CanvasInput,
	operation: Extract<DiagramPatchOperation, { op: "group" | "ungroup" }>,
): BuildIssue[] {
	const ids = new Set(operation.ids);
	if (operation.ids.some((id) => !scene.elements.some((element) => element.id === id))) {
		return [targetIssue(operation)];
	}
	const grouped = scene.elements.map((element) => {
		if (!ids.has(element.id)) return element;
		if (operation.op === "group") {
			return {
				...element,
				groupIds: [...new Set([...(element.groupIds ?? []), operation.groupId])],
			};
		}
		return {
			...element,
			groupIds: operation.groupId
				? (element.groupIds ?? []).filter((id) => id !== operation.groupId)
				: [],
		};
	});
	scene.elements.splice(0, scene.elements.length, ...grouped);
	return [];
}

export function applyPatchOperation(
	scene: CanvasInput,
	operation: DiagramPatchOperation,
): BuildIssue[] {
	switch (operation.op) {
		case "setDefaultStyle":
		case "setStyle":
			return applyStyle(scene, operation);
		case "setShape":
			return applyShape(scene, operation);
		case "translate":
			return applyTranslate(scene, operation);
		case "replaceText":
			return applyReplaceText(scene, operation);
		case "rerouteEdges":
			return applyRerouteEdges(scene, operation);
		case "insert":
			return applyInsert(scene, operation);
		case "remove":
			return applyRemove(scene, operation);
		case "replace":
			return applyReplace(scene, operation);
		case "reorder":
			return applyReorder(scene, operation);
		case "group":
		case "ungroup":
			return applyGroup(scene, operation);
	}
}
