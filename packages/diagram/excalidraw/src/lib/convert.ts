import {
	type ArrowSceneElement,
	type FrameSceneElement,
	type LineSceneElement,
	type NodeSceneElement,
	type RenderedDiagramScene,
	type SceneElement,
	type TextSceneElement,
} from "@sketchi/diagram-renderer";
import {
	AXIS_ALIGNED_EPSILON,
	boundLabelWidth,
	CANVAS_CROSSABLE_RENDERER_ROLES,
	canvasBoundTextBox,
	canvasBoundTextInset,
	canvasNodeIconBox,
	canvasComposedOnOutline,
	canvasShapeOutline,
	canvasShapeStrokes,
	fnv1a32,
	isCanvasComposedShape,
	type AxisAlignedSegment,
	isSharedBoundStem,
	routingQualityFindings,
	type RoutingQualityFinding,
	routingQualityScale,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
	segmentsOverlapInterior,
	SKETCHI_DIAGRAM_PALETTE,
	wrappedLabelWidth,
	wrapTextToWidth,
} from "@sketchi/diagram-core";
import { generateKeyBetween } from "fractional-indexing";

export type ExcalidrawElement = Record<string, unknown> & {
	id: string;
	type: string;
};

/** Excalidraw BinaryFileData: the image bytes an `image` element points at. */
export interface ExcalidrawBinaryFile {
	created: number;
	dataURL: string;
	id: string;
	lastRetrieved?: number;
	mimeType: string;
	version?: number;
}

export interface ExcalidrawScene {
	appState: Record<string, unknown>;
	elements: ExcalidrawElement[];
	/** Image files keyed by fileId; absent on scenes stored before node logos. */
	files?: Record<string, ExcalidrawBinaryFile>;
}

export interface ExcalidrawFile {
	appState: Record<string, unknown>;
	elements: ExcalidrawElement[];
	files: Record<string, unknown>;
	source: string;
	type: "excalidraw";
	version: 2;
}

export interface ExcalidrawSceneValidationIssue {
	code:
		| "arrow-endpoint-off-shape"
		| "empty-scene"
		| "invalid-elbow-binding"
		| "arrow-segment-through-node"
		| "missing-image-file"
		| "missing-arrow-binding"
		| "missing-bound-arrow"
		| "missing-container"
		| "overlapping-arrow-segment"
		| "text-overflow";
	elementId?: string;
	message: string;
}

export interface ExcalidrawSceneValidationResult {
	issues: ExcalidrawSceneValidationIssue[];
	ok: boolean;
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const TEXT_LINE_HEIGHT = 1.35;
const TEXT_HORIZONTAL_PADDING = 24;
const TEXT_VERTICAL_PADDING = 18;
const ARROW_LABEL_WIDTH = 160;
const FIT_TARGET_WIDTH = 860;
const FIT_TARGET_HEIGHT = 340;
const MIN_INITIAL_ZOOM = 0.42;
const DEFAULT_TEXT_COLOR = SKETCHI_DIAGRAM_PALETTE.ink;
const DEFAULT_EXCALIDRAW_EXPORT_SOURCE = "https://sketchi.app";

type BindingKey = "startBinding" | "endBinding";

interface ElementBounds {
	height: number;
	width: number;
	x: number;
	y: number;
}

function numericValue(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePointTuple(value: unknown): [number, number] | null {
	if (!Array.isArray(value) || value.length < 2) {
		return null;
	}

	const x = numericValue(value[0]);
	const y = numericValue(value[1]);

	return x === null || y === null ? null : [x, y];
}

function elementBounds(element: ExcalidrawElement): ElementBounds | null {
	const x = numericValue(element.x);
	const y = numericValue(element.y);
	const width = numericValue(element.width);
	const height = numericValue(element.height);

	return x === null || y === null || width === null || height === null
		? null
		: { x, y, width, height };
}

function normalizedFixedPoint(value: number): number {
	return Math.abs(value - 0.5) < 0.0001 ? 0.5001 : value;
}

function fixedPointForShape(
	shape: ExcalidrawElement,
	point: { x: number; y: number },
): [number, number] | null {
	const bounds = elementBounds(shape);

	if (!bounds || bounds.width === 0 || bounds.height === 0) {
		return null;
	}

	return [
		normalizedFixedPoint((point.x - bounds.x) / bounds.width),
		normalizedFixedPoint((point.y - bounds.y) / bounds.height),
	];
}

function bindingForShape(shape: ExcalidrawElement | undefined, point: { x: number; y: number }) {
	return {
		elementId: shape?.id ?? "",
		focus: 0,
		gap: 0,
		fixedPoint: shape ? fixedPointForShape(shape, point) : null,
	};
}

function initialZoomForScene(scene: RenderedDiagramScene): number {
	const zoom = Math.min(
		1,
		FIT_TARGET_WIDTH / Math.max(scene.width, 1),
		FIT_TARGET_HEIGHT / Math.max(scene.height, 1),
	);

	return Math.max(MIN_INITIAL_ZOOM, Math.round(zoom * 100) / 100);
}

function elementBase(id: string, element?: RenderedDiagramScene["elements"][number]) {
	const seed = fnv1a32(id, "seed");
	return {
		id,
		angle: 0,
		fillStyle: element && "fillStyle" in element ? (element.fillStyle ?? "solid") : "solid",
		frameId: element?.frameId ?? null,
		groupIds: [...(element?.groupIds ?? [])],
		// Reserve the serialized property position; assign only after z-order sorting.
		index: null,
		isDeleted: false,
		link: null,
		locked: element?.locked ?? false,
		opacity: element?.opacity ?? 100,
		roughness: element && "roughness" in element ? (element.roughness ?? 1) : 1,
		seed,
		strokeStyle: element && "strokeStyle" in element ? (element.strokeStyle ?? "solid") : "solid",
		strokeWidth: element && "strokeWidth" in element ? (element.strokeWidth ?? 2) : 2,
		updated: 1,
		version: 1,
		versionNonce: seed + 1,
	};
}

function textHeight(text: string, fontSize: number, lineHeight = TEXT_LINE_HEIGHT): number {
	return Math.ceil(text.split("\n").length * fontSize * lineHeight);
}

/** Excalidraw computeBoundTextPosition for top- and bottom-aligned labels. */
function boundTextTop(
	container: NodeSceneElement,
	height: number,
	verticalAlign: "bottom" | "top",
): number {
	const top = container.y + canvasBoundTextInset(container).y;
	return verticalAlign === "top" ? top : top + canvasBoundTextBox(container).height - height;
}

function textElement(input: {
	container?: NodeSceneElement;
	containerId?: string;
	element?: TextSceneElement;
	fontSize: number;
	id: string;
	locked?: boolean;
	maxWidth: number;
	textColor?: string;
	text: string;
	wrap?: boolean;
	x: number;
	y: number;
}): ExcalidrawElement {
	// Excalidraw paints restored text at its stored wrap and size until the text
	// is edited, so a line wider than its stored box is clipped on first paint.
	// Connector labels have no container height to respect and wrap to fit; node
	// labels arrive wrapped and their nodes sized by the renderer or the author.
	const text = input.wrap
		? wrapTextToWidth(input.text, input.maxWidth, input.fontSize)
		: input.text;
	const width = input.wrap
		? wrappedLabelWidth(text, input.fontSize, input.maxWidth)
		: boundLabelWidth(text, input.fontSize, input.maxWidth);
	const lineHeight = input.element?.lineHeight ?? TEXT_LINE_HEIGHT;
	const height = textHeight(text, input.fontSize, lineHeight);
	const verticalAlign = input.element?.verticalAlign;

	return {
		...elementBase(input.id, input.element),
		...(input.locked === undefined ? {} : { locked: input.locked }),
		type: "text",
		x: input.x - width / 2,
		y:
			input.container && (verticalAlign === "bottom" || verticalAlign === "top")
				? boundTextTop(input.container, height, verticalAlign)
				: input.y - height / 2,
		width,
		height,
		backgroundColor: "transparent",
		boundElements: null,
		containerId: input.containerId ?? null,
		fontFamily:
			input.element?.fontFamily === "mono" ? 3 : input.element?.fontFamily === "sans" ? 2 : 5,
		fontSize: input.fontSize,
		lineHeight,
		originalText: input.text,
		roundness: null,
		strokeColor: input.textColor ?? DEFAULT_TEXT_COLOR,
		text,
		textAlign: input.element?.textAlign ?? "center",
		verticalAlign: input.element?.verticalAlign ?? "middle",
		// Unbound text with autoResize re-flows to one line on edit; keep wrapped
		// connector labels at their stored width instead.
		autoResize: !(input.wrap && !input.containerId),
	};
}

function utf8Base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

/** Content-addressed so equal artwork shares one file across scenes. */
function iconFileId(slug: string, svg: string): string {
	return `sketchi-icon-${slug}-${fnv1a32(svg, "hex", "utf16")}`;
}

function iconFile(id: string, svg: string): ExcalidrawBinaryFile {
	return {
		id,
		mimeType: "image/svg+xml",
		dataURL: `data:image/svg+xml;base64,${utf8Base64(svg)}`,
		created: 1,
		lastRetrieved: 1,
	};
}

/** Group that moves a node's shape, label, logo and outline strokes together. */
function logoGroupId(node: NodeSceneElement): string {
	return isCanvasComposedShape(node.shape) ? `${node.id}:shape` : `${node.id}:logo`;
}

/**
 * The strokes that draw a composed shape (a cylinder, pipe or document) over
 * its bindable box, each a line, smooth along an arc; under them, when the
 * node asks for a fill, its outline as one filled line with no stroke. None of
 * them binds, so lines meet the shape only at its box.
 */
function shapeStrokeElements(input: {
	id: (index: number) => string;
	scene: RenderedDiagramScene;
	shape: NodeSceneElement;
}): ExcalidrawElement[] {
	const { shape } = input;
	if (!isCanvasComposedShape(shape.shape)) return [];
	const composed = { ...shape, shape: shape.shape };
	const strokes = [
		...(shape.fillColor
			? [{ fill: shape.fillColor, points: canvasShapeOutline(composed), smooth: false }]
			: []),
		...canvasShapeStrokes(composed).map((stroke) => ({ ...stroke, fill: undefined })),
	];
	return strokes.map((stroke, index) => {
		const [start] = stroke.points;
		const xs = stroke.points.map((point) => point.x);
		const ys = stroke.points.map((point) => point.y);
		return {
			...elementBase(input.id(index), shape),
			groupIds: [logoGroupId(shape), ...(shape.groupIds ?? [])],
			type: "line",
			x: start!.x,
			y: start!.y,
			width: Math.max(...xs) - Math.min(...xs),
			height: Math.max(...ys) - Math.min(...ys),
			backgroundColor: stroke.fill ?? "transparent",
			boundElements: null,
			customData: { sketchiShapeStroke: shape.shape },
			endArrowhead: null,
			endBinding: null,
			lastCommittedPoint: null,
			points: stroke.points.map((point) => [point.x - start!.x, point.y - start!.y]),
			// Hand-drawn jitter along a short arc reads as a dent; the outline stays
			// crisp unless the node asks for a rougher hand.
			roughness: shape.roughness ?? 0,
			roundness: stroke.smooth ? { type: 2 } : null,
			startArrowhead: null,
			startBinding: null,
			strokeColor: stroke.fill ? "transparent" : (shape.strokeColor ?? input.scene.accentColor),
		};
	});
}

function iconImageElement(input: {
	fileId: string;
	id: string;
	node: NodeSceneElement;
}): ExcalidrawElement | null {
	const box = canvasNodeIconBox(input.node);
	if (!box || !input.node.icon) return null;
	return {
		...elementBase(input.id, input.node),
		groupIds: [logoGroupId(input.node), ...(input.node.groupIds ?? [])],
		type: "image",
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		backgroundColor: "transparent",
		boundElements: null,
		crop: null,
		customData: { sketchiNodeIcon: input.node.icon.slug },
		fileId: input.fileId,
		roundness: null,
		scale: [1, 1],
		status: "saved",
		strokeColor: "transparent",
	};
}

function shapeElement(input: {
	arrowIds: readonly string[];
	scene: RenderedDiagramScene;
	shape: NodeSceneElement;
	text?: TextSceneElement;
}): ExcalidrawElement {
	const height = input.shape.height;
	const shapeType = input.shape.shape === "circle" ? "ellipse" : input.shape.shape;
	const boundElements = [
		...(input.text && input.shape.shape !== "polygon" ? [{ id: input.text.id, type: "text" }] : []),
		...input.arrowIds.map((id) => ({ id, type: "arrow" })),
	];

	if (input.shape.shape === "polygon") {
		const points = input.shape.points ?? [
			{ x: input.shape.width / 2, y: 0 },
			{ x: input.shape.width, y: input.shape.height },
			{ x: 0, y: input.shape.height },
		];
		const [first] = points;
		return {
			...elementBase(input.shape.id, input.shape),
			type: "line",
			x: input.shape.x,
			y: input.shape.y,
			width: input.shape.width,
			height: input.shape.height,
			backgroundColor: input.shape.fillColor ?? "transparent",
			boundElements: input.arrowIds.map((id) => ({ id, type: "arrow" })),
			customData: {
				sketchiShape: "polygon",
				...(input.shape.rendererRole ? { sketchiRendererRole: input.shape.rendererRole } : {}),
			},
			endArrowhead: null,
			endBinding: null,
			lastCommittedPoint: null,
			points: [...points, first].map((point) => [point.x, point.y]),
			roundness: null,
			startArrowhead: null,
			startBinding: null,
			strokeColor: input.shape.strokeColor ?? input.scene.accentColor,
		};
	}

	// A composed shape's box only binds its label and lines; its strokes draw it.
	if (isCanvasComposedShape(input.shape.shape))
		return {
			...elementBase(input.shape.id, input.shape),
			groupIds: [logoGroupId(input.shape), ...(input.shape.groupIds ?? [])],
			type: "rectangle",
			x: input.shape.x,
			y: input.shape.y,
			width: input.shape.width,
			height,
			backgroundColor: "transparent",
			boundElements: boundElements.length > 0 ? boundElements : null,
			customData: { sketchiShape: input.shape.shape },
			roundness: null,
			strokeColor: "transparent",
		};

	return {
		...elementBase(input.shape.id, input.shape),
		type: shapeType,
		x: input.shape.x,
		y: input.shape.y,
		width: input.shape.width,
		height,
		backgroundColor: input.shape.fillColor ?? "transparent",
		boundElements: boundElements.length > 0 ? boundElements : null,
		// Chart and Gantt bars keep square corners, so their ends sit exactly at their
		// values and dates, a table's or class's outline and name band keep theirs,
		// so the band fills its top, and lanes keep theirs, so neighbors share one
		// boundary.
		roundness:
			shapeType === "rectangle" &&
			input.shape.rendererRole !== "chart-mark" &&
			input.shape.rendererRole !== "gantt-mark" &&
			input.shape.rendererRole !== "er-table" &&
			input.shape.rendererRole !== "class-box" &&
			input.shape.rendererRole !== "swimlane" &&
			input.shape.rendererRole !== "swimlane-header" &&
			input.shape.rendererRole !== "zone"
				? { type: 3 }
				: null,
		strokeColor: input.shape.strokeColor ?? input.scene.accentColor,
		...(input.shape.rendererRole
			? { customData: { sketchiRendererRole: input.shape.rendererRole } }
			: {}),
	};
}

/** A table or a class box: lines bound to one keep their fixed points when it moves. */
function isTableShape(element: ExcalidrawElement | undefined): boolean {
	const customData = element?.customData;
	if (customData === null || typeof customData !== "object") return false;
	const role = (customData as Record<string, unknown>)["sketchiRendererRole"];
	return role === "er-table" || role === "class-box";
}

function lastArrowPoint(arrow: ArrowSceneElement) {
	return arrow.points[arrow.points.length - 1] ?? arrow.points[0];
}

function arrowElement(input: {
	arrow: ArrowSceneElement;
	scene: RenderedDiagramScene;
	sourceShape: ExcalidrawElement | undefined;
	targetShape: ExcalidrawElement | undefined;
	text?: TextSceneElement;
}): ExcalidrawElement {
	const start = input.arrow.points[0];
	const end = lastArrowPoint(input.arrow);
	// Excalidraw resolves a straight arrow's binding against its target's outline,
	// which a frame lacks, and re-aims it at a table's or class's middle; an elbow
	// arrow keeps its fixed point on a moved frame, and on the row of a moved table
	// or the port of a moved class. A curved connector stays a curved arrow through
	// its points.
	const elbowed =
		input.arrow.curved !== true &&
		(input.arrow.points.length > 2 ||
			[input.sourceShape, input.targetShape].some(
				(shape) => shape?.type === "frame" || isTableShape(shape),
			));

	return {
		...elementBase(input.arrow.id, input.arrow),
		type: "arrow",
		x: start.x,
		y: start.y,
		width: end.x - start.x,
		height: end.y - start.y,
		backgroundColor: "transparent",
		boundElements: input.text
			? input.text.containerId === input.arrow.id
				? [{ id: input.text.id, type: "text" }]
				: null
			: input.arrow.label
				? [{ id: `${input.arrow.id}:label`, type: "text" }]
				: null,
		elbowed,
		endArrowhead: input.arrow.endArrowhead === undefined ? "arrow" : input.arrow.endArrowhead,
		endBinding: bindingForShape(input.targetShape, end),
		...(elbowed
			? {
					fixedSegments: [],
					startIsSpecial: null,
					endIsSpecial: null,
				}
			: {}),
		points: input.arrow.points.map((point) => [point.x - start.x, point.y - start.y]),
		roundness: elbowed ? null : { type: 2 },
		startArrowhead: input.arrow.startArrowhead ?? null,
		startBinding: bindingForShape(input.sourceShape, start),
		strokeColor: input.arrow.strokeColor ?? input.scene.accentColor,
		strokeStyle: input.arrow.strokeStyle ?? "solid",
	};
}

function bindingForLine(
	binding: LineSceneElement["startBinding"],
	elementsById: ReadonlyMap<string, ExcalidrawElement>,
	point: { x: number; y: number },
) {
	if (!binding) return null;
	const shape = elementsById.get(binding.elementId);
	if (!shape) return null;
	return {
		elementId: binding.elementId,
		focus: binding.focus ?? 0,
		gap: binding.gap ?? 0,
		fixedPoint: fixedPointForShape(shape, point),
	};
}

function lineElement(input: {
	element: LineSceneElement;
	elementsById: ReadonlyMap<string, ExcalidrawElement>;
	scene: RenderedDiagramScene;
}): ExcalidrawElement {
	const [start, ...rest] = input.element.points;
	const end = rest[rest.length - 1] ?? start;
	const hasArrow =
		input.element.startArrowhead !== undefined ||
		input.element.endArrowhead !== undefined ||
		input.element.startBinding !== undefined ||
		input.element.endBinding !== undefined;
	const elbowed = hasArrow && input.element.points.length > 2;
	return {
		...elementBase(input.element.id, input.element),
		type: hasArrow ? "arrow" : "line",
		x: start.x,
		y: start.y,
		width: end.x - start.x,
		height: end.y - start.y,
		backgroundColor: input.element.fillColor ?? "transparent",
		boundElements: null,
		...(hasArrow ? { elbowed } : {}),
		endArrowhead: input.element.endArrowhead ?? null,
		endBinding: bindingForLine(input.element.endBinding, input.elementsById, end),
		...(elbowed
			? {
					fixedSegments: [],
					startIsSpecial: null,
					endIsSpecial: null,
				}
			: {}),
		points: input.element.points.map((point) => [point.x - start.x, point.y - start.y]),
		roundness: input.element.points.length > 2 && !elbowed ? { type: 2 } : null,
		startArrowhead: input.element.startArrowhead ?? null,
		startBinding: bindingForLine(input.element.startBinding, input.elementsById, start),
		strokeColor: input.element.strokeColor ?? input.scene.accentColor,
	};
}

function frameElement(input: {
	element: FrameSceneElement;
	scene: RenderedDiagramScene;
}): ExcalidrawElement {
	return {
		...elementBase(input.element.id, input.element),
		type: "frame",
		x: input.element.x,
		y: input.element.y,
		width: input.element.width,
		height: input.element.height,
		backgroundColor: input.element.fillColor ?? "transparent",
		boundElements: null,
		name: input.element.name ?? null,
		roundness: null,
		strokeColor: input.element.strokeColor ?? input.scene.accentColor,
	};
}

function arrowLabelElement(input: { arrow: ArrowSceneElement }): ExcalidrawElement | null {
	if (!input.arrow.label) {
		return null;
	}

	const start = input.arrow.points[0];
	const end = lastArrowPoint(input.arrow);
	return textElement({
		id: `${input.arrow.id}:label`,
		containerId: input.arrow.id,
		fontSize: 13,
		...(input.arrow.locked === undefined ? {} : { locked: input.arrow.locked }),
		maxWidth: ARROW_LABEL_WIDTH,
		...(input.arrow.textColor ? { textColor: input.arrow.textColor } : {}),
		text: input.arrow.label,
		wrap: true,
		x: (start.x + end.x) / 2,
		y: (start.y + end.y) / 2 - 10,
	});
}

function collectBoundArrowsByElement(
	nodes: readonly NodeSceneElement[],
	frames: readonly FrameSceneElement[],
	arrows: readonly ArrowSceneElement[],
	lines: readonly LineSceneElement[],
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	const elementIdByNodeId = new Map([
		...nodes.map((node) => [node.nodeId, node.id] as const),
		...frames.flatMap((frame) =>
			frame.nodeId === undefined ? [] : [[frame.nodeId, frame.id] as const],
		),
	]);

	for (const arrow of arrows) {
		for (const nodeId of [arrow.sourceNodeId, arrow.targetNodeId]) {
			const shapeId = elementIdByNodeId.get(nodeId);
			if (!shapeId) continue;
			result.set(shapeId, [...(result.get(shapeId) ?? []), arrow.id]);
		}
	}
	for (const line of lines) {
		for (const binding of [line.startBinding, line.endBinding]) {
			if (!binding) continue;
			result.set(binding.elementId, [...(result.get(binding.elementId) ?? []), line.id]);
		}
	}

	return result;
}

function isNode(element: RenderedDiagramScene["elements"][number]): element is NodeSceneElement {
	return element.type === "node";
}

function isText(element: RenderedDiagramScene["elements"][number]): element is TextSceneElement {
	return element.type === "text";
}

function isArrow(element: RenderedDiagramScene["elements"][number]): element is ArrowSceneElement {
	return element.type === "arrow";
}

function isLine(element: RenderedDiagramScene["elements"][number]): element is LineSceneElement {
	return element.type === "line";
}

function isFrame(element: RenderedDiagramScene["elements"][number]): element is FrameSceneElement {
	return element.type === "frame";
}

function applyLayerSemantics(scene: RenderedDiagramScene): SceneElement[] {
	const layersById = new Map(scene.layers.map((layer) => [layer.id, layer]));
	const layerVisibleElements = scene.elements.filter((element) => {
		const layer = element.layerId ? layersById.get(element.layerId) : undefined;
		return layer?.visible !== false;
	});
	// Connectors end at nodes, or at frames that carry a node id (composite states).
	const visibleNodeIds = new Set(
		layerVisibleElements.flatMap((element) =>
			element.type === "node"
				? [element.nodeId]
				: element.type === "frame" && element.nodeId !== undefined
					? [element.nodeId]
					: [],
		),
	);
	const connectionSafeElements = layerVisibleElements.filter(
		(element) =>
			element.type !== "arrow" ||
			(visibleNodeIds.has(element.sourceNodeId) && visibleNodeIds.has(element.targetNodeId)),
	);
	const visibleContainerIds = new Set(
		connectionSafeElements.flatMap((element) => (element.type === "text" ? [] : [element.id])),
	);
	const visibleElements = connectionSafeElements.filter(
		(element) =>
			element.type !== "text" ||
			!element.containerId ||
			visibleContainerIds.has(element.containerId),
	);
	const visibleElementIds = new Set(visibleElements.map((element) => element.id));

	return visibleElements.map((element) => {
		const layer = element.layerId ? layersById.get(element.layerId) : undefined;
		const { frameId: _frameId, ...withoutFrame } = element;
		const visibleElement =
			element.frameId && !visibleElementIds.has(element.frameId) ? withoutFrame : element;
		return {
			...visibleElement,
			...(layer?.locked === true ? { locked: true } : {}),
		};
	});
}

function synthesizeNodeLabels(sourceElements: readonly SceneElement[]): {
	textElements: TextSceneElement[];
	generatedLabelSourceIds: Map<string, string>;
} {
	const nodes = sourceElements.filter(isNode);
	const textElements = sourceElements.filter(isText);
	const usedElementIds = new Set(sourceElements.map((element) => element.id));
	const generatedLabelSourceIds = new Map<string, string>();
	const explicitlyLabeledNodeIds = new Set(
		textElements.flatMap((element) => (element.containerId ? [element.containerId] : [])),
	);
	for (const node of nodes) {
		if (explicitlyLabeledNodeIds.has(node.id) || node.rendererRole) {
			continue;
		}
		const baseId = `__sketchi_node_label__${node.id}`;
		let id = baseId;
		let suffix = 2;
		while (usedElementIds.has(id)) {
			id = `${baseId}:${suffix}`;
			suffix += 1;
		}
		usedElementIds.add(id);
		generatedLabelSourceIds.set(id, node.id);
		textElements.push({
			type: "text",
			id,
			containerId: node.id,
			...(node.frameId ? { frameId: node.frameId } : {}),
			...(node.groupIds ? { groupIds: [...node.groupIds] } : {}),
			...(node.layerId ? { layerId: node.layerId } : {}),
			...(node.locked !== undefined ? { locked: node.locked } : {}),
			...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
			...(node.textColor ? { textColor: node.textColor } : {}),
			x: node.x + node.width / 2,
			y: node.y + node.height / 2,
			text: node.label,
			fontSize: 16,
			maxWidth: Math.max(1, node.width - TEXT_HORIZONTAL_PADDING),
		});
	}
	return { textElements, generatedLabelSourceIds };
}

function iconElementId(node: NodeSceneElement, usedElementIds: Set<string>): string {
	// Excalidraw's SVG export selects per-element image symbols by id, so the
	// id must be a valid CSS identifier fragment (node ids contain colons).
	const baseId = `${node.id.replace(/[^\w-]/gu, "-")}-icon`;
	let id = baseId;
	let suffix = 2;
	while (usedElementIds.has(id)) {
		id = `${baseId}-${suffix}`;
		suffix += 1;
	}
	usedElementIds.add(id);
	return id;
}

/** An id for a composed shape's stroke, unique in the scene. */
function strokeElementId(
	node: NodeSceneElement,
	index: number,
	usedElementIds: Set<string>,
): string {
	const baseId = `${node.id}:stroke-${index}`;
	let id = baseId;
	let suffix = 2;
	while (usedElementIds.has(id)) {
		id = `${baseId}-${suffix}`;
		suffix += 1;
	}
	usedElementIds.add(id);
	return id;
}

function buildElements(
	scene: RenderedDiagramScene,
	sourceElements: readonly SceneElement[],
	textElements: readonly TextSceneElement[],
	files: Record<string, ExcalidrawBinaryFile>,
	generatedSourceIds: Map<string, string>,
): ExcalidrawElement[] {
	const nodes = sourceElements.filter(isNode);
	const usedElementIds = new Set([
		...sourceElements.map((element) => element.id),
		...textElements.map((element) => element.id),
	]);
	const logoNodesById = new Map<string, NodeSceneElement>();
	const textByContainerId = new Map<string, TextSceneElement>();
	for (const text of textElements) {
		if (text.containerId) textByContainerId.set(text.containerId, text);
	}
	const arrows = sourceElements.filter(isArrow);
	const lines = sourceElements.filter(isLine);
	const arrowsByElement = collectBoundArrowsByElement(
		nodes,
		sourceElements.filter(isFrame),
		arrows,
		lines,
	);
	const shapeElementsByNodeId = new Map<string, ExcalidrawElement>();
	const elements: ExcalidrawElement[] = [];
	for (const node of nodes) {
		const text = textByContainerId.get(node.id);
		const shape = shapeElement({
			scene,
			shape: node,
			arrowIds: arrowsByElement.get(node.id) ?? [],
			...(text ? { text } : {}),
		});

		shapeElementsByNodeId.set(node.nodeId, shape);
		elements.push(shape);
		if (isCanvasComposedShape(node.shape)) {
			const strokes = shapeStrokeElements({
				id: (index) => strokeElementId(node, index, usedElementIds),
				scene,
				shape: node,
			});
			for (const stroke of strokes) generatedSourceIds.set(stroke.id, node.id);
			elements.push(...strokes);
			logoNodesById.set(node.id, node);
		}

		const asset =
			node.icon && scene.icons && Object.hasOwn(scene.icons, node.icon.slug)
				? scene.icons[node.icon.slug]
				: undefined;
		if (!node.icon || typeof asset?.svg !== "string") continue;
		const fileId = iconFileId(node.icon.slug, asset.svg);
		const id = iconElementId(node, usedElementIds);
		const image = iconImageElement({ fileId, id, node });
		if (!image) continue;
		files[fileId] ??= iconFile(fileId, asset.svg);
		shape.groupIds = [logoGroupId(node), ...(node.groupIds ?? [])];
		generatedSourceIds.set(id, node.id);
		logoNodesById.set(node.id, node);
		elements.push(image);
	}

	for (const frame of sourceElements.filter(isFrame)) {
		const renderedFrame = frameElement({
			element: frame,
			scene,
		});
		const arrowIds = arrowsByElement.get(frame.id) ?? [];
		renderedFrame.boundElements = arrowIds.length
			? arrowIds.map((id) => ({ id, type: "arrow" }))
			: null;
		// A composite state's transitions bind to its frame.
		if (frame.nodeId !== undefined) shapeElementsByNodeId.set(frame.nodeId, renderedFrame);
		elements.push(renderedFrame);
	}

	for (const text of textElements) {
		const containerNode = nodes.find(
			(node) => node.id === text.containerId && node.shape !== "polygon",
		);
		const arrowContainer = arrows.some((arrow) => arrow.id === text.containerId);
		const positionedArrow = arrows.find((arrow) => text.id === `${arrow.id}:label`);
		const supportedContainer = text.containerId && (containerNode || arrowContainer);
		const textColor = text.textColor ?? positionedArrow?.textColor;
		const label = textElement({
			...(containerNode ? { container: containerNode } : {}),
			element: text,
			id: text.id,
			...(supportedContainer ? { containerId: text.containerId } : {}),
			fontSize: text.fontSize,
			maxWidth: text.maxWidth ?? 160,
			...(textColor ? { textColor } : {}),
			text: text.text,
			wrap: arrowContainer || Boolean(positionedArrow),
			x: text.x,
			y: text.y,
		});
		const logoNode = containerNode ? logoNodesById.get(containerNode.id) : undefined;
		if (logoNode) {
			label.groupIds = [logoGroupId(logoNode), ...(text.groupIds ?? [])];
		}
		elements.push(label);
	}

	for (const arrow of arrows) {
		const text =
			textByContainerId.get(arrow.id) ??
			textElements.find((text) => text.id === `${arrow.id}:label`);
		elements.push(
			arrowElement({
				arrow,
				scene,
				sourceShape: shapeElementsByNodeId.get(arrow.sourceNodeId),
				targetShape: shapeElementsByNodeId.get(arrow.targetNodeId),
				...(text ? { text } : {}),
			}),
		);
		const label = arrow.label && !text ? arrowLabelElement({ arrow }) : null;
		if (label) {
			elements.push(label);
		}
	}

	const excalidrawElementsById = new Map(elements.map((element) => [element.id, element]));
	for (const line of lines) {
		elements.push(
			lineElement({
				element: line,
				elementsById: excalidrawElementsById,
				scene,
			}),
		);
		if (line.label) {
			const start = line.points[0];
			const end = line.points[line.points.length - 1] ?? start;
			elements.push(
				textElement({
					id: `${line.id}:label`,
					fontSize: 13,
					...(line.locked === undefined ? {} : { locked: line.locked }),
					maxWidth: ARROW_LABEL_WIDTH,
					...(line.textColor ? { textColor: line.textColor } : {}),
					text: line.label,
					wrap: true,
					x: (start.x + end.x) / 2,
					y: (start.y + end.y) / 2 - 10,
				}),
			);
		}
	}

	return elements;
}

function applyZOrder(
	scene: RenderedDiagramScene,
	elements: ExcalidrawElement[],
	generatedSourceIds: ReadonlyMap<string, string>,
): void {
	const zOrder = new Map(scene.zOrder.map((id, index) => [id, index]));
	const sourceIdForElement = (element: ExcalidrawElement): string => {
		if (zOrder.has(element.id)) return element.id;
		const generatedSourceId = generatedSourceIds.get(element.id);
		if (generatedSourceId) return generatedSourceId;
		return element.id.endsWith(":label") ? element.id.slice(0, -":label".length) : element.id;
	};
	elements.sort((left, right) => {
		const leftOrder = zOrder.get(sourceIdForElement(left)) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = zOrder.get(sourceIdForElement(right)) ?? Number.MAX_SAFE_INTEGER;
		return leftOrder - rightOrder;
	});
	let previousIndex: string | null = null;
	for (const element of elements) {
		const index = generateKeyBetween(previousIndex, null);
		element.index = index;
		previousIndex = index;
	}
}

export function convertSceneToExcalidraw(scene: RenderedDiagramScene): ExcalidrawScene {
	const sourceElements = applyLayerSemantics(scene);
	const { textElements, generatedLabelSourceIds } = synthesizeNodeLabels(sourceElements);
	const files: Record<string, ExcalidrawBinaryFile> = {};
	// Generated labels and logos sort with the scene element they belong to.
	const generatedSourceIds = new Map(generatedLabelSourceIds);
	const elements = buildElements(scene, sourceElements, textElements, files, generatedSourceIds);
	applyZOrder(scene, elements, generatedSourceIds);
	return {
		appState: {
			viewBackgroundColor: scene.backgroundColor,
			zoom: {
				value: initialZoomForScene(scene),
			},
		},
		elements,
		files,
	};
}

export function createExcalidrawFile(
	scene: ExcalidrawScene,
	options: { source?: string } = {},
): ExcalidrawFile {
	return {
		type: "excalidraw",
		version: 2,
		source: options.source ?? DEFAULT_EXCALIDRAW_EXPORT_SOURCE,
		elements: scene.elements,
		appState: scene.appState,
		files: scene.files ?? {},
	};
}

function hasBoundElement(element: ExcalidrawElement, id: string, type: string): boolean {
	const boundElements = element.boundElements;
	if (!Array.isArray(boundElements)) {
		return false;
	}

	return boundElements.some((bound) => {
		if (!(bound && typeof bound === "object")) {
			return false;
		}
		return (bound as { id?: unknown }).id === id && (bound as { type?: unknown }).type === type;
	});
}

function bindingElementId(element: ExcalidrawElement, key: string): string | null {
	const binding = element[key];
	if (!(binding && typeof binding === "object")) {
		return null;
	}

	const elementId = (binding as { elementId?: unknown }).elementId;
	return typeof elementId === "string" ? elementId : null;
}

function bindingFixedPoint(element: ExcalidrawElement, key: BindingKey): [number, number] | null {
	const binding = element[key];
	if (!(binding && typeof binding === "object")) {
		return null;
	}

	return finitePointTuple((binding as { fixedPoint?: unknown }).fixedPoint);
}

interface ArrowSegment extends AxisAlignedSegment {
	arrowId: string;
	startBindingId: string | null;
	endBindingId: string | null;
	startCoordinate: number;
	endCoordinate: number;
	/** The whole route, in scene coordinates. */
	route: readonly { readonly x: number; readonly y: number }[];
}

function arrowSegments(element: ExcalidrawElement): ArrowSegment[] {
	const originX = numericValue(element.x) ?? 0;
	const originY = numericValue(element.y) ?? 0;
	const startBindingId = bindingElementId(element, "startBinding");
	const endBindingId = bindingElementId(element, "endBinding");
	const points = Array.isArray(element.points)
		? element.points
				.map(finitePointTuple)
				.filter((point): point is [number, number] => point !== null)
				.map(([x, y]) => ({ x: originX + x, y: originY + y }))
		: [];
	return segmentsFromPoints(points).map((segment) => ({
		...segment,
		arrowId: element.id,
		startBindingId,
		endBindingId,
		startCoordinate:
			segment.orientation === "horizontal"
				? points[segment.segmentIndex]!.x
				: points[segment.segmentIndex]!.y,
		endCoordinate:
			segment.orientation === "horizontal"
				? points[segment.segmentIndex + 1]!.x
				: points[segment.segmentIndex + 1]!.y,
		route: points,
	}));
}

/**
 * Arrows that leave one shape at one point may run together before they part,
 * as the bus from an org chart's manager to their reports does: a run both take
 * from the same corner in the same direction, after the same route up to it, is
 * one trunk drawn once.
 */
function sharesTrunk(left: ArrowSegment, right: ArrowSegment): boolean {
	if (
		left.startBindingId === null ||
		left.startBindingId !== right.startBindingId ||
		left.segmentIndex !== right.segmentIndex
	)
		return false;
	for (let index = 0; index <= left.segmentIndex; index += 1) {
		const a = left.route[index];
		const b = right.route[index];
		if (
			!a ||
			!b ||
			Math.abs(a.x - b.x) > AXIS_ALIGNED_EPSILON ||
			Math.abs(a.y - b.y) > AXIS_ALIGNED_EPSILON
		)
			return false;
	}
	return (
		Math.sign(left.endCoordinate - left.startCoordinate) ===
		Math.sign(right.endCoordinate - right.startCoordinate)
	);
}

/** A common binding alone cannot exempt unrelated portions of two routes. */
function sharesDirectedEndpoint(left: ArrowSegment, right: ArrowSegment): boolean {
	if (!isSharedBoundStem(left, right)) return false;
	const departure =
		left.isFirstSegment &&
		right.isFirstSegment &&
		left.startBindingId !== null &&
		left.startBindingId === right.startBindingId;
	const leftEndpoint = departure ? left.startCoordinate : left.endCoordinate;
	const rightEndpoint = departure ? right.startCoordinate : right.endCoordinate;
	return (
		Math.abs(leftEndpoint - rightEndpoint) <= AXIS_ALIGNED_EPSILON &&
		Math.sign(left.endCoordinate - left.startCoordinate) ===
			Math.sign(right.endCoordinate - right.startCoordinate)
	);
}

/**
 * Arrows bound into one shape at one point may share their whole last straight stretch, as a Gantt
 * dependency that joins another's last run into their successor does: both segments lie on it and
 * head the same way.
 */
function sharesArrivalStem(left: ArrowSegment, right: ArrowSegment): boolean {
	const [leftEnd, rightEnd] = [left.route.at(-1), right.route.at(-1)];
	if (
		left.endBindingId === null ||
		left.endBindingId !== right.endBindingId ||
		!leftEnd ||
		!rightEnd ||
		Math.abs(leftEnd.x - rightEnd.x) > AXIS_ALIGNED_EPSILON ||
		Math.abs(leftEnd.y - rightEnd.y) > AXIS_ALIGNED_EPSILON
	)
		return false;
	const onStem = (segment: ArrowSegment) =>
		segment.route
			.slice(segment.segmentIndex)
			.every((point) =>
				segment.orientation === "horizontal"
					? Math.abs(point.y - segment.route[segment.segmentIndex]!.y) <= AXIS_ALIGNED_EPSILON
					: Math.abs(point.x - segment.route[segment.segmentIndex]!.x) <= AXIS_ALIGNED_EPSILON,
			);
	return (
		onStem(left) &&
		onStem(right) &&
		Math.sign(left.endCoordinate - left.startCoordinate) ===
			Math.sign(right.endCoordinate - right.startCoordinate)
	);
}

function overlappingArrowSegments(
	elements: readonly ExcalidrawElement[],
): ExcalidrawSceneValidationIssue[] {
	const segments = elements.filter((element) => element.type === "arrow").flatMap(arrowSegments);
	const issues: ExcalidrawSceneValidationIssue[] = [];
	const seen = new Set<string>();

	for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
		const left = segments[leftIndex];
		if (!left) {
			continue;
		}

		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
			const right = segments[rightIndex];
			if (!right) {
				continue;
			}

			if (
				left.arrowId === right.arrowId ||
				sharesDirectedEndpoint(left, right) ||
				sharesTrunk(left, right) ||
				sharesArrivalStem(left, right) ||
				!segmentsOverlapInterior(left, right)
			) {
				continue;
			}

			const key = [
				left.arrowId,
				String(left.segmentIndex),
				right.arrowId,
				String(right.segmentIndex),
			]
				.sort()
				.join(":");
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			issues.push({
				code: "overlapping-arrow-segment",
				elementId: left.arrowId,
				message: `Arrow "${left.arrowId}" overlaps arrow "${right.arrowId}".`,
			});
		}
	}

	return issues;
}

function isBindableShape(element: ExcalidrawElement): boolean {
	if (SHAPE_TYPES.has(element.type) || element.type === "frame") return true;
	const customData = element.customData;
	return (
		element.type === "line" &&
		customData !== null &&
		typeof customData === "object" &&
		(customData as Record<string, unknown>)["sketchiShape"] === "polygon"
	);
}

function arrowSegmentsThroughShapes(
	elements: readonly ExcalidrawElement[],
): ExcalidrawSceneValidationIssue[] {
	const segments = elements.filter((element) => element.type === "arrow").flatMap(arrowSegments);
	const shapes = elements.filter(isBindableShape);
	const frameOf = new Map(
		elements.flatMap((element) =>
			typeof element.frameId === "string" ? [[element.id, element.frameId] as const] : [],
		),
	);
	const issues: ExcalidrawSceneValidationIssue[] = [];
	const seen = new Set<string>();

	for (const segment of segments) {
		for (const shape of shapes) {
			if (
				isSequenceStructureShape(shape) ||
				shape.id === segment.startBindingId ||
				shape.id === segment.endBindingId ||
				containsArrowEnd(shape, segment, frameOf)
			) {
				continue;
			}

			const bounds = elementBounds(shape);
			if (!bounds || !segmentCrossesBoundsInterior(segment, bounds)) {
				continue;
			}

			const key = `${segment.arrowId}:${segment.segmentIndex}:${shape.id}`;
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			issues.push({
				code: "arrow-segment-through-node",
				elementId: segment.arrowId,
				message: `Arrow "${segment.arrowId}" passes through shape "${shape.id}".`,
			});
		}
	}

	return issues;
}

/**
 * A frame holds an arrow that belongs to it or is bound to one of its children:
 * that arrow has to cross into the frame. Every other frame stays an obstacle.
 */
function containsArrowEnd(
	shape: ExcalidrawElement,
	segment: ArrowSegment,
	frameOf: ReadonlyMap<string, string>,
): boolean {
	return (
		shape.type === "frame" &&
		[segment.arrowId, segment.startBindingId, segment.endBindingId].some(
			(id) => id !== null && frameOf.get(id) === shape.id,
		)
	);
}

/** Messages may cross other participants' lifelines and activation bars. */
function isSequenceStructureShape(element: ExcalidrawElement): boolean {
	const customData = element.customData;
	if (customData === null || typeof customData !== "object") return false;
	const role = (customData as Record<string, unknown>)["sketchiRendererRole"];
	return CANVAS_CROSSABLE_RENDERER_ROLES.some((candidate) => candidate === role);
}

function arrowEndpoint(element: ExcalidrawElement, key: BindingKey) {
	const x = numericValue(element.x) ?? 0;
	const y = numericValue(element.y) ?? 0;
	const points = Array.isArray(element.points)
		? element.points
				.map(finitePointTuple)
				.filter((point): point is [number, number] => Boolean(point))
		: [];
	const point = key === "startBinding" ? points[0] : points[points.length - 1];

	return point ? { x: x + point[0], y: y + point[1] } : null;
}

function between(value: number, min: number, max: number): boolean {
	return value >= min - AXIS_ALIGNED_EPSILON && value <= max + AXIS_ALIGNED_EPSILON;
}

function near(value: number, target: number): boolean {
	return Math.abs(value - target) <= AXIS_ALIGNED_EPSILON;
}

function pointOnShapeBoundary(point: { x: number; y: number }, shape: ExcalidrawElement): boolean {
	const bounds = elementBounds(shape);

	if (!bounds) {
		return false;
	}

	// A composed shape's box only binds; a line ends on the outline its strokes draw.
	const composed =
		shape.customData && typeof shape.customData === "object"
			? (shape.customData as Record<string, unknown>)["sketchiShape"]
			: undefined;
	if (typeof composed === "string" && isCanvasComposedShape(composed)) {
		return canvasComposedOnOutline({ ...bounds, shape: composed }, point);
	}

	if (shape.type === "diamond") {
		const halfWidth = bounds.width / 2;
		const halfHeight = bounds.height / 2;

		if (halfWidth === 0 || halfHeight === 0) {
			return false;
		}

		const centerX = bounds.x + halfWidth;
		const centerY = bounds.y + halfHeight;
		const boundaryValue =
			Math.abs(point.x - centerX) / halfWidth + Math.abs(point.y - centerY) / halfHeight;

		return near(boundaryValue, 1);
	}

	if (shape.type === "ellipse") {
		const halfWidth = bounds.width / 2;
		const halfHeight = bounds.height / 2;

		if (halfWidth === 0 || halfHeight === 0) {
			return false;
		}

		const centerX = bounds.x + halfWidth;
		const centerY = bounds.y + halfHeight;
		const boundaryValue =
			((point.x - centerX) / halfWidth) ** 2 + ((point.y - centerY) / halfHeight) ** 2;

		return near(boundaryValue, 1);
	}

	const onVerticalSide =
		(near(point.x, bounds.x) || near(point.x, bounds.x + bounds.width)) &&
		between(point.y, bounds.y, bounds.y + bounds.height);
	const onHorizontalSide =
		(near(point.y, bounds.y) || near(point.y, bounds.y + bounds.height)) &&
		between(point.x, bounds.x, bounds.x + bounds.width);

	return onVerticalSide || onHorizontalSide;
}

function fixedPointResolvesToEndpoint(
	fixedPoint: [number, number],
	point: { x: number; y: number },
	shape: ExcalidrawElement,
): boolean {
	const bounds = elementBounds(shape);

	if (!bounds) {
		return false;
	}

	const fixedX = Math.abs(fixedPoint[0] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[0];
	const fixedY = Math.abs(fixedPoint[1] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[1];

	return (
		near(bounds.x + fixedX * bounds.width, point.x) &&
		near(bounds.y + fixedY * bounds.height, point.y)
	);
}

/** A non-elbow arrow Excalidraw draws as a smooth curve through its points. */
function isCurved(element: ExcalidrawElement): boolean {
	const roundness = element.roundness;
	return (
		element.elbowed !== true &&
		roundness !== null &&
		typeof roundness === "object" &&
		(roundness as { type?: unknown }).type === 2
	);
}

function absoluteArrowPoints(element: ExcalidrawElement): { x: number; y: number }[] {
	const x = numericValue(element.x) ?? 0;
	const y = numericValue(element.y) ?? 0;
	return Array.isArray(element.points)
		? element.points
				.map(finitePointTuple)
				.filter((point): point is [number, number] => point !== null)
				.map(([px, py]) => ({ x: x + px, y: y + py }))
		: [];
}

/**
 * Reader-scale routing polish on the exported geometry: endpoint jogs,
 * near-coincident corridors and touching arrowheads, judged at the size of the
 * PNG a reader sees.
 */
export function exportedRoutingQualityFindings(scene: ExcalidrawScene): RoutingQualityFinding[] {
	const elements = scene.elements.filter((element) => element.isDeleted !== true);
	const arrows = elements.filter((element) => element.type === "arrow");
	const corners = elements.flatMap((element) => {
		if (element.type === "arrow" || element.type === "line") return absoluteArrowPoints(element);
		const bounds = elementBounds(element);
		return bounds ? [bounds, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }] : [];
	});
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	return routingQualityFindings(
		arrows.map((element) => ({
			id: element.id,
			points: absoluteArrowPoints(element),
			sourceId: bindingElementId(element, "startBinding"),
			targetId: bindingElementId(element, "endBinding"),
			endArrowhead: element.endArrowhead !== null && element.endArrowhead !== undefined,
		})),
		routingQualityScale({
			width: Math.max(...xs) - Math.min(...xs),
			height: Math.max(...ys) - Math.min(...ys),
		}),
	);
}

export function validateExcalidrawScene(scene: ExcalidrawScene): ExcalidrawSceneValidationResult {
	const issues: ExcalidrawSceneValidationIssue[] = [];
	const elementsById = new Map(scene.elements.map((element) => [element.id, element]));
	const shapeIds = new Set(scene.elements.filter(isBindableShape).map((element) => element.id));

	if (scene.elements.length === 0) {
		issues.push({
			code: "empty-scene",
			message: "Excalidraw scene must contain at least one shape.",
		});
	}

	for (const element of scene.elements) {
		if (
			element.type === "image" &&
			(typeof element.fileId !== "string" ||
				!scene.files ||
				!Object.hasOwn(scene.files, element.fileId))
		) {
			issues.push({
				code: "missing-image-file",
				elementId: element.id,
				message: `Image "${element.id}" references a file missing from the scene.`,
			});
		}

		if (element.type === "arrow") {
			const isElbowed = element.elbowed === true;
			const points = Array.isArray(element.points) ? element.points : [];

			if (points.length > 2 && !isElbowed && !isCurved(element)) {
				issues.push({
					code: "invalid-elbow-binding",
					elementId: element.id,
					message: `Arrow "${element.id}" has an orthogonal route but is not marked elbowed.`,
				});
			}

			if (isElbowed && element.fixedSegments !== null && !Array.isArray(element.fixedSegments)) {
				issues.push({
					code: "invalid-elbow-binding",
					elementId: element.id,
					message: `Elbow arrow "${element.id}" is missing fixedSegments metadata.`,
				});
			}

			for (const bindingKey of ["startBinding", "endBinding"] as const) {
				if (element[bindingKey] === null || element[bindingKey] === undefined) {
					continue;
				}
				const shapeId = bindingElementId(element, bindingKey);
				if (!(shapeId && shapeIds.has(shapeId))) {
					issues.push({
						code: "missing-arrow-binding",
						elementId: element.id,
						message: `Arrow "${element.id}" has invalid ${bindingKey}.`,
					});
					continue;
				}

				const shape = elementsById.get(shapeId);
				if (shape && !hasBoundElement(shape, element.id, "arrow")) {
					issues.push({
						code: "missing-bound-arrow",
						elementId: shape.id,
						message: `Shape "${shape.id}" does not include bound arrow "${element.id}".`,
					});
				}

				const endpoint = arrowEndpoint(element, bindingKey);
				if (shape && endpoint && !pointOnShapeBoundary(endpoint, shape)) {
					issues.push({
						code: "arrow-endpoint-off-shape",
						elementId: element.id,
						message: `Arrow "${element.id}" ${bindingKey} endpoint does not land on "${shape.id}".`,
					});
				}

				if (shape && endpoint && isElbowed) {
					const fixedPoint = bindingFixedPoint(element, bindingKey);
					if (!fixedPoint || !fixedPointResolvesToEndpoint(fixedPoint, endpoint, shape)) {
						issues.push({
							code: "invalid-elbow-binding",
							elementId: element.id,
							message: `Elbow arrow "${element.id}" has invalid ${bindingKey} fixedPoint metadata.`,
						});
					}
				}
			}
		}

		if (element.type === "text") {
			const containerId = element.containerId;
			if (typeof containerId !== "string") {
				continue;
			}

			const container = elementsById.get(containerId);
			if (!container) {
				issues.push({
					code: "missing-container",
					elementId: element.id,
					message: `Text "${element.id}" references missing container "${containerId}".`,
				});
				continue;
			}

			// A label box may reach into the fontSize/2 canvas padding on each side
			// (see boundLabelWidth) without its glyphs leaving the container.
			const textWidth =
				(typeof element.width === "number" ? element.width : 0) -
				(typeof element.fontSize === "number" ? element.fontSize : 0);
			const textHeightValue = typeof element.height === "number" ? element.height : 0;
			const containerWidth = typeof container.width === "number" ? container.width : 0;
			const containerHeight = typeof container.height === "number" ? container.height : 0;

			if (
				isBindableShape(container) &&
				(textWidth + TEXT_HORIZONTAL_PADDING > containerWidth ||
					textHeightValue + TEXT_VERTICAL_PADDING > containerHeight)
			) {
				issues.push({
					code: "text-overflow",
					elementId: element.id,
					message: `Text "${element.id}" does not fit inside "${containerId}".`,
				});
			}
		}
	}

	issues.push(...arrowSegmentsThroughShapes(scene.elements));
	issues.push(...overlappingArrowSegments(scene.elements));

	return {
		ok: issues.length === 0,
		issues,
	};
}
