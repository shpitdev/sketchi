/** Owns Canvas node/text/marker and group/lane/zone elements, frames and export bounds. */
import {
	NODE_LABEL_FONT_SIZE,
	NODE_LABEL_HORIZONTAL_PADDING,
	measureDescription,
	NODE_LABEL_LINE_HEIGHT,
	NODE_DESCRIPTION_COLOR,
	NODE_DESCRIPTION_GAP,
	NODE_DESCRIPTION_FONT_SIZE,
	NODE_DESCRIPTION_LINE_HEIGHT,
	NODE_DESCRIPTION_MAX_LINES,
	PADDING,
	branchLabelMetrics,
} from "./measure.js";
import {
	type CanvasShapeElement as NodeSceneElement,
	type CanvasTextElement as TextSceneElement,
	type CanvasSpec,
	type CanvasElement as SceneElement,
	type CanvasPoint as ScenePoint,
	type CanvasShapeKind as NodeSceneShape,
	canvasGroupIconRun,
	boundLabelWidth,
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasFrameElement as FrameSceneElement,
} from "@sketchi/drawing";
import { type RoutedEdge, type LaneLayout, type GroupLayout } from "./layout-types.js";
import {
	laneElementId,
	LANE_LABEL_FONT_SIZE,
	LANE_HEADER_PADDING,
	ZONE_LABEL_INSET,
	ZONE_LABEL_FONT_SIZE,
	ZONE_HEADER,
	insideBox,
} from "./containers.js";
import { type DiagramZoneKind } from "./intermediate.js";

function textForNode(shape: NodeSceneElement, described = false): TextSceneElement {
	return {
		type: "text",
		id: `label:${shape.nodeId}`,
		containerId: shape.id,
		...(described && shape.groupIds ? { groupIds: [...shape.groupIds] } : {}),
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2,
		text: shape.label,
		fontSize: NODE_LABEL_FONT_SIZE,
		maxWidth: Math.max(1, shape.width - NODE_LABEL_HORIZONTAL_PADDING),
		// The logo sits at the top of the text box; the label stacks beneath it,
		// or stays centered above a description.
		...(shape.icon && !described ? { verticalAlign: "bottom" as const } : {}),
	};
}

/** Group that moves a described node, its label and its description together. */
function describedGroupId(shape: NodeSceneElement): string {
	return `${shape.id}:described`;
}

/** A node's description, under its centered label and grouped with it. */
function descriptionForNode(shape: NodeSceneElement, description: string): TextSceneElement {
	const metrics = measureDescription(description, shape.shape);
	const labelHeight = Math.ceil(
		shape.label.split("\n").length * NODE_LABEL_FONT_SIZE * NODE_LABEL_LINE_HEIGHT,
	);
	return {
		type: "text",
		id: `description:${shape.nodeId}`,
		...(shape.groupIds ? { groupIds: [...shape.groupIds] } : {}),
		textColor: NODE_DESCRIPTION_COLOR,
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2 + labelHeight / 2 + NODE_DESCRIPTION_GAP + metrics.height / 2,
		text: metrics.text,
		fontSize: NODE_DESCRIPTION_FONT_SIZE,
		lineHeight: NODE_DESCRIPTION_LINE_HEIGHT,
		maxWidth: Math.ceil(metrics.width),
	};
}

/** Labels and descriptions of drawn nodes; a described node joins a group with both. */
export function nodeTexts(
	shapes: readonly NodeSceneElement[],
	descriptions: ReadonlyMap<string, string>,
): { nodes: NodeSceneElement[]; texts: TextSceneElement[] } {
	const nodes = shapes.map((shape) =>
		descriptions.has(shape.nodeId)
			? { ...shape, groupIds: [describedGroupId(shape), ...(shape.groupIds ?? [])] }
			: shape,
	);
	// Pseudostates draw no label.
	const texts = nodes
		.filter((shape) => shape.label)
		.flatMap((shape) => {
			const description = descriptions.get(shape.nodeId);
			return description
				? [textForNode(shape, true), descriptionForNode(shape, description)]
				: [textForNode(shape)];
		});
	return { nodes, texts };
}

/**
 * Nodes whose description runs past NODE_DESCRIPTION_MAX_LINES at its shape's
 * widest. They draw in full; a build warns so the author can shorten them.
 */
export function longNodeDescriptions(scene: CanvasSpec): string[] {
	return scene.elements.flatMap((element) =>
		element.type === "text" &&
		element.id.startsWith("description:") &&
		element.text.split("\n").length > NODE_DESCRIPTION_MAX_LINES
			? [element.id.slice("description:".length)]
			: [],
	);
}

export function sceneBounds(elements: readonly SceneElement[]): {
	width: number;
	height: number;
} {
	const points = scenePoints(elements);
	const maxX = Math.max(...points.map((point) => point.x));
	const maxY = Math.max(...points.map((point) => point.y));

	return {
		width: maxX + PADDING,
		height: maxY + PADDING,
	};
}

function sceneMinimum(elements: readonly SceneElement[]): ScenePoint {
	const points = scenePoints(elements);
	return {
		x: Math.min(...points.map((point) => point.x)),
		y: Math.min(...points.map((point) => point.y)),
	};
}

function scenePoints(elements: readonly SceneElement[]): ScenePoint[] {
	return elements.flatMap((element): ScenePoint[] => {
		if (element.type === "arrow" || element.type === "line") {
			return [...element.points];
		}

		if (element.type === "text") {
			// Node labels are centered and contained by their already-counted shape.
			if (element.containerId) return [];
			const halfWidth = (element.maxWidth ?? element.text.length) / 2;
			const halfHeight = (element.text.split("\n").length * element.fontSize * 1.35) / 2;
			return [
				{ x: element.x - halfWidth, y: element.y - halfHeight },
				{
					x: element.x + halfWidth,
					y: element.y + halfHeight,
				},
			];
		}

		return [
			{ x: element.x, y: element.y },
			{
				x: element.x + element.width,
				y: element.y + element.height,
			},
		];
	});
}

function translatePoint(point: ScenePoint, dx: number, dy: number): ScenePoint {
	return { x: point.x + dx, y: point.y + dy };
}

function translatePoints(
	points: readonly [ScenePoint, ...ScenePoint[]],
	dx: number,
	dy: number,
): [ScenePoint, ...ScenePoint[]] {
	const [first, ...rest] = points;
	return [translatePoint(first, dx, dy), ...rest.map((point) => translatePoint(point, dx, dy))];
}

function translateLinePoints(
	points: readonly [ScenePoint, ScenePoint, ...ScenePoint[]],
	dx: number,
	dy: number,
): [ScenePoint, ScenePoint, ...ScenePoint[]] {
	const [first, second, ...rest] = points;
	return [
		translatePoint(first, dx, dy),
		translatePoint(second, dx, dy),
		...rest.map((point) => translatePoint(point, dx, dy)),
	];
}

function translateElement(element: SceneElement, dx: number, dy: number): SceneElement {
	if (element.type === "arrow") {
		return {
			...element,
			points: translatePoints(element.points, dx, dy),
		};
	}

	if (element.type === "line") {
		return {
			...element,
			points: translateLinePoints(element.points, dx, dy),
		};
	}

	return {
		...element,
		x: element.x + dx,
		y: element.y + dy,
	};
}

export function normalizeSceneOrigin(elements: readonly SceneElement[]): SceneElement[] {
	const minimum = sceneMinimum(elements);
	const dx = Math.max(0, PADDING - minimum.x);
	const dy = Math.max(0, PADDING - minimum.y);

	if (dx === 0 && dy === 0) {
		return [...elements];
	}

	return elements.map((element) => translateElement(element, dx, dy));
}

/** Shapes each marker kind draws as: a final's core is the filled dot inside its ring. */
const MARKER_SHAPES: Readonly<Record<string, NodeSceneShape>> = {
	initial: "circle",
	final: "circle",
	"final-core": "circle",
	choice: "diamond",
};

/** What each marker is, for readers of the scene; markers never draw it. */
const MARKER_NAMES: Readonly<Record<string, string>> = {
	initial: "Initial state",
	final: "Final state",
	"final-core": "Final state",
	choice: "Choice",
};

/**
 * A state marker keeps its role while it still reads as one: a marker kind in
 * its own shape, without an icon. A choice grows with its branches, so its
 * size never decides.
 */
export function isStructurallyValidStateMarker(element: {
	readonly icon?: unknown;
	readonly kind?: string;
	readonly shape: string;
}): boolean {
	return (
		element.kind !== undefined &&
		MARKER_SHAPES[element.kind] === element.shape &&
		element.icon === undefined
	);
}

/** A final bullseye's filled core: a fifth of its ring's edge from the ring. */
const FINAL_CORE_INSET = 6;

/**
 * Draw a pseudostate as a marker: the initial dot filled, the final bullseye a
 * ring with a filled core grouped to it, a choice an empty diamond. A marker
 * draws no label; its name stays on the shape. Other nodes draw as laid out.
 */
export function drawnMarker(shape: NodeSceneElement, accent: string): NodeSceneElement[] {
	if (shape.label) return [shape];
	const marker = {
		...shape,
		label: MARKER_NAMES[shape.kind ?? ""] ?? "Marker",
		rendererRole: "state-marker" as const,
	};
	if (shape.kind === "initial") return [{ ...marker, fillColor: accent, fillStyle: "solid" }];
	if (shape.kind !== "final") return [marker];
	const groupIds = [`marker:${shape.nodeId}`, ...(shape.groupIds ?? [])];
	return [
		{ ...marker, groupIds },
		{
			...marker,
			id: `${shape.id}:core`,
			nodeId: `${shape.nodeId}:core`,
			kind: "final-core",
			groupIds,
			x: shape.x + FINAL_CORE_INSET,
			y: shape.y + FINAL_CORE_INSET,
			width: shape.width - 2 * FINAL_CORE_INSET,
			height: shape.height - 2 * FINAL_CORE_INSET,
			fillColor: accent,
			fillStyle: "solid",
		},
	];
}

/** A lane header's fill: the Sketchi paper tone, so the strip reads apart from the lane. */
const LANE_HEADER_FILL = "#f6f1e7";

/**
 * Each lane as locked shapes under the diagram: its band, its header strip and
 * the header's name. Locked, they stay put while steps move across them in the
 * editor, and a click on a lane selects nothing.
 */
export function laneElements(lanes: LaneLayout): (NodeSceneElement | TextSceneElement)[] {
	return lanes.frames.flatMap((frame): (NodeSceneElement | TextSceneElement)[] => {
		const id = laneElementId(frame);
		const header: NodeSceneElement = {
			type: "node",
			id: `${id}:header`,
			nodeId: `${id}:header`,
			kind: "lane-header",
			rendererRole: "swimlane-header",
			shape: "rectangle",
			...frame.header,
			label: frame.text,
			fillColor: LANE_HEADER_FILL,
			fillStyle: "solid",
			roughness: 0,
			strokeWidth: 1,
			locked: true,
		};
		return [
			{
				type: "node",
				id,
				nodeId: id,
				kind: "lane",
				rendererRole: "swimlane",
				shape: "rectangle",
				...frame.box,
				label: frame.label,
				// Crisp, thin lines: neighbors share one boundary, and the steps read first.
				roughness: 0,
				strokeWidth: 1,
				locked: true,
			},
			header,
			{
				type: "text",
				id: `${id}:label`,
				containerId: header.id,
				x: header.x + header.width / 2,
				y: header.y + header.height / 2,
				text: frame.text,
				fontSize: LANE_LABEL_FONT_SIZE,
				maxWidth: Math.max(1, header.width - 2 * LANE_HEADER_PADDING),
				locked: true,
			},
		];
	});
}

/** A zone label's ink: quieter than the steps, which read first. */
const ZONE_LABEL_COLOR = "#4c4639";

/** Fills that set a subnet or a namespace apart from the zone around it. */
const ZONE_FILL: Readonly<Partial<Record<DiagramZoneKind, string>>> = {
	subnet: "#f6f1e7",
	namespace: "#efe6ec",
};

/**
 * How each kind of zone draws: outer boundaries (a cloud or a data center) in
 * dark ink, a network on either side of them in a lighter dark line, a region
 * dashed, an availability zone dotted, a VPC or a cluster in a heavier line,
 * and a subnet or a namespace filled.
 */
function zoneStyle(
	kind: DiagramZoneKind | undefined,
	accent: string,
): Pick<
	NodeSceneElement,
	"fillColor" | "fillStyle" | "strokeColor" | "strokeStyle" | "strokeWidth"
> {
	const fill = kind === undefined ? undefined : ZONE_FILL[kind];
	return {
		strokeColor:
			kind === "cloud" || kind === "datacenter" || kind === "network" ? ZONE_LABEL_COLOR : accent,
		strokeStyle:
			kind === "cloud" || kind === "region" || kind === "namespace"
				? "dashed"
				: kind === "zone"
					? "dotted"
					: "solid",
		strokeWidth:
			kind === "cloud" || kind === "datacenter" || kind === "vpc" || kind === "cluster" ? 2 : 1,
		...(fill ? { fillColor: fill, fillStyle: "solid" as const } : {}),
	};
}

/**
 * Each zone as locked shapes under the diagram, outermost first: its outline,
 * styled by its kind, and its label at the left of the header strip across its
 * top. Locked, they stay put while steps move across them in the editor.
 */
export function zoneElements(
	groups: GroupLayout,
	accent: string,
): (NodeSceneElement | TextSceneElement)[] {
	return groups.frames.flatMap((frame): (NodeSceneElement | TextSceneElement)[] => {
		const logo = canvasGroupIconRun(frame.icon);
		const maxWidth = Math.max(1, frame.box.width - 2 * ZONE_LABEL_INSET - logo);
		return [
			{
				type: "node",
				id: frame.elementId,
				nodeId: frame.elementId,
				kind: frame.kind ?? "zone",
				...(frame.icon ? { icon: frame.icon } : {}),
				rendererRole: "zone",
				shape: "rectangle",
				...frame.box,
				label: frame.label,
				...zoneStyle(frame.kind, accent),
				roughness: 0,
				locked: true,
			},
			{
				type: "text",
				id: `zone-label:${frame.id}`,
				x:
					frame.box.x +
					ZONE_LABEL_INSET +
					logo +
					boundLabelWidth(frame.label, ZONE_LABEL_FONT_SIZE, maxWidth) / 2,
				y: frame.box.y + ZONE_HEADER / 2,
				text: frame.label,
				fontSize: ZONE_LABEL_FONT_SIZE,
				maxWidth,
				textAlign: "left",
				textColor: ZONE_LABEL_COLOR,
				locked: true,
			},
		];
	});
}

/**
 * Draw each group as an Excalidraw frame named by its label, and make every
 * member a child of it: nodes and their labels always, and a group's own edges
 * with their labels when they lie wholly inside, since a frame clips its
 * children. Moving the frame in the editor then moves the whole group.
 */
export function withGroupFrames(
	groups: GroupLayout,
	drawn: {
		readonly arrows: readonly ArrowSceneElement[];
		readonly labels: readonly TextSceneElement[];
		readonly nodes: readonly NodeSceneElement[];
	},
	routes: readonly RoutedEdge[],
): {
	arrows: ArrowSceneElement[];
	frames: FrameSceneElement[];
	labels: TextSceneElement[];
	nodes: NodeSceneElement[];
} {
	const frames = new Map(groups.frames.map((frame) => [frame.id, frame]));
	const frameOf = (nodeId: string) => {
		const group = groups.groupOf.get(nodeId);
		return group === undefined ? undefined : frames.get(group);
	};
	const branchLabelsById = new Map(drawn.labels.map((label) => [label.id, label]));
	const arrowFrames = new Map<string, string>();
	for (const arrow of drawn.arrows) {
		const frame = frameOf(arrow.sourceNodeId);
		if (!frame || frame !== frameOf(arrow.targetNodeId)) continue;
		const label = branchLabelsById.get(`${arrow.id}:label`);
		const size = label
			? branchLabelMetrics(
					routes.find((route) => route.edge.id === arrow.edgeId)!.edge,
					label.maxWidth === 80,
				)
			: undefined;
		const labelInside =
			!label ||
			!size ||
			[
				{ x: label.x - size.width / 2, y: label.y - size.height / 2 },
				{ x: label.x + size.width / 2, y: label.y + size.height / 2 },
			].every((point) => insideBox(point, frame.box));
		if (labelInside && arrow.points.every((point) => insideBox(point, frame.box)))
			arrowFrames.set(arrow.id, frame.elementId);
	}
	const nodeFrames = new Map(
		drawn.nodes.flatMap((node) => {
			const frame = frameOf(node.nodeId);
			return frame ? [[node.id, frame.elementId] as const] : [];
		}),
	);
	return {
		arrows: drawn.arrows.map((arrow) => {
			const frameId = arrowFrames.get(arrow.id);
			return frameId ? { ...arrow, frameId } : arrow;
		}),
		frames: groups.frames.map((frame) => ({
			type: "frame",
			id: frame.elementId,
			name: frame.label,
			...(frame.icon ? { icon: frame.icon } : {}),
			// Edges into and out of a composite bind to its frame.
			...(groups.composites.has(frame.id) ? { nodeId: frame.id } : {}),
			...frame.box,
		})),
		labels: drawn.labels.map((label) => {
			const frameId = label.containerId
				? nodeFrames.get(label.containerId)
				: label.id.startsWith("description:")
					? nodeFrames.get(`node:${label.id.slice("description:".length)}`)
					: arrowFrames.get(label.id.slice(0, -":label".length));
			return frameId ? { ...label, frameId } : label;
		}),
		nodes: drawn.nodes.map((node) => {
			const frameId = nodeFrames.get(node.id);
			return frameId ? { ...node, frameId } : node;
		}),
	};
}
