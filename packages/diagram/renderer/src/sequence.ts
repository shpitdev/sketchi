import {
	CANVAS_SPEC_VERSION,
	SEQUENCE_LIFELINE_SUFFIX,
	type SequenceDiagram,
	sequenceLifelineId,
	validateSequenceDiagram,
	wrapTextToWidth,
} from "@sketchi/diagram-core";
import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	TextSceneElement,
} from "./scene.js";

const PADDING = 48;
const HEADER_WIDTH = 180;
const HEADER_HEIGHT = 72;
const HEADER_LABEL_WIDTH = HEADER_WIDTH - 24;
const PARTICIPANT_GAP = 140;
const MESSAGE_GAP = 88;
const MESSAGE_TOP_GAP = 64;
const LIFELINE_BOTTOM_GAP = 56;
const LIFELINE_WIDTH = 2;
const LABEL_FONT_SIZE = 14;
const LABEL_LINE_HEIGHT = 1.35;
const LABEL_VERTICAL_PADDING = 18;
const LAYOUT_ALIGNMENT_EPSILON = 0.01;

export const SEQUENCE_LIFELINE_ROLE = "sequence-lifeline";

interface SequenceLifelineStructureNode {
	readonly type: "node";
	readonly id: string;
	readonly nodeId: string;
	readonly shape: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

interface SequenceLifelineStructureScene {
	readonly elements: readonly (
		| SequenceLifelineStructureNode
		| {
				readonly type: "arrow" | "frame" | "line" | "text";
				readonly id: string;
		  }
	)[];
}

export function isStructurallyValidSequenceLifeline(
	scene: SequenceLifelineStructureScene,
	element: SequenceLifelineStructureNode,
): boolean {
	const suffix = SEQUENCE_LIFELINE_SUFFIX;
	if (
		!element.nodeId.endsWith(suffix) ||
		element.id !== `node:${element.nodeId}` ||
		element.shape !== "rectangle" ||
		element.width !== LIFELINE_WIDTH ||
		element.height < MESSAGE_TOP_GAP + LIFELINE_BOTTOM_GAP
	) {
		return false;
	}

	const participantId = element.nodeId.slice(0, -suffix.length);
	if (participantId.length === 0) {
		return false;
	}
	const header = scene.elements.find(
		(candidate): candidate is SequenceLifelineStructureNode =>
			candidate.type === "node" &&
			candidate.id === `node:${participantId}` &&
			candidate.nodeId === participantId,
	);
	if (!header) {
		return false;
	}

	return (
		Math.abs(element.x + element.width / 2 - (header.x + header.width / 2)) <=
			LAYOUT_ALIGNMENT_EPSILON && element.y >= header.y + header.height - LAYOUT_ALIGNMENT_EPSILON
	);
}

/**
 * Render a canonical sequence diagram: participants become ordered header
 * columns with lifelines, and messages become rows in chronological order.
 */
export function renderSequenceDiagram(diagram: SequenceDiagram): RenderedDiagramScene {
	const input = validateSequenceDiagram(diagram);
	const columnStep = HEADER_WIDTH + PARTICIPANT_GAP;
	const headerLabelById = new Map(
		input.participants.map((participant) => [
			participant.id,
			wrapTextToWidth(participant.label, HEADER_LABEL_WIDTH, LABEL_FONT_SIZE),
		]),
	);
	// Size the shared header row before laying out lifelines and message lanes.
	const headerHeight = input.participants.reduce(
		(height, participant) =>
			Math.max(
				height,
				Math.ceil(
					(headerLabelById.get(participant.id) ?? participant.label).split("\n").length *
						LABEL_FONT_SIZE *
						LABEL_LINE_HEIGHT,
				) + LABEL_VERTICAL_PADDING,
			),
		HEADER_HEIGHT,
	);
	const headerY = PADDING;
	const lifelineY = headerY + headerHeight;
	const firstMessageY = lifelineY + MESSAGE_TOP_GAP;
	const lastMessageY = firstMessageY + Math.max(0, input.messages.length - 1) * MESSAGE_GAP;
	const lifelineHeight = Math.max(firstMessageY, lastMessageY) - lifelineY + LIFELINE_BOTTOM_GAP;
	const centerXByParticipant = new Map<string, number>();
	const headers: NodeSceneElement[] = [];
	const headerLabels: TextSceneElement[] = [];
	const lifelines: NodeSceneElement[] = [];

	input.participants.forEach((participant, index) => {
		const x = PADDING + index * columnStep;
		const centerX = x + HEADER_WIDTH / 2;
		centerXByParticipant.set(participant.id, centerX);
		headers.push({
			type: "node",
			id: `node:${participant.id}`,
			nodeId: participant.id,
			...(participant.kind ? { kind: participant.kind } : {}),
			shape: "rectangle",
			x,
			y: headerY,
			width: HEADER_WIDTH,
			height: headerHeight,
			label: headerLabelById.get(participant.id) ?? participant.label,
		});
		headerLabels.push({
			type: "text",
			id: `label:${participant.id}`,
			containerId: `node:${participant.id}`,
			x: centerX,
			y: headerY + headerHeight / 2,
			text: headerLabelById.get(participant.id) ?? participant.label,
			fontSize: LABEL_FONT_SIZE,
			maxWidth: HEADER_LABEL_WIDTH,
		});
		lifelines.push({
			type: "node",
			id: `node:${sequenceLifelineId(participant.id)}`,
			nodeId: sequenceLifelineId(participant.id),
			rendererRole: SEQUENCE_LIFELINE_ROLE,
			shape: "rectangle",
			fillColor: input.style.backgroundColor,
			strokeColor: input.style.accentColor,
			x: centerX - LIFELINE_WIDTH / 2,
			y: lifelineY,
			width: LIFELINE_WIDTH,
			height: lifelineHeight,
			label: `${participant.label} lifeline`,
		});
	});

	const messageArrows: ArrowSceneElement[] = input.messages.map((message, index) => {
		// Validation guarantees both participants exist and differ.
		const sourceX = centerXByParticipant.get(message.source) ?? 0;
		const targetX = centerXByParticipant.get(message.target) ?? 0;
		const y = firstMessageY + index * MESSAGE_GAP;
		const direction = targetX > sourceX ? 1 : -1;
		return {
			type: "arrow",
			id: `arrow:${message.id}`,
			edgeId: message.id,
			sourceNodeId: sequenceLifelineId(message.source),
			targetNodeId: sequenceLifelineId(message.target),
			...(message.type === "return" ? { strokeColor: "#6b7280" } : {}),
			...(message.style === "dashed" || message.type === "return"
				? { strokeStyle: "dashed" as const }
				: {}),
			points: [
				{ x: sourceX + (direction * LIFELINE_WIDTH) / 2, y },
				{ x: targetX - (direction * LIFELINE_WIDTH) / 2, y },
			],
			label: message.label,
		};
	});

	const elements = [...messageArrows, ...lifelines, ...headers, ...headerLabels];
	const zOrder = [
		...lifelines.map((element) => element.id),
		...headers.map((element) => element.id),
		...headerLabels.map((element) => element.id),
		...messageArrows.map((element) => element.id),
	];

	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: input.id,
		title: input.title,
		width: PADDING * 2 + HEADER_WIDTH + Math.max(0, input.participants.length - 1) * columnStep,
		height: lifelineY + lifelineHeight + PADDING,
		accentColor: input.style.accentColor,
		backgroundColor: input.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder,
	};
}
