import {
	CANVAS_SPEC_VERSION,
	SEQUENCE_LIFELINE_SUFFIX,
	type SequenceActivation,
	type SequenceDiagram,
	sequenceActivationId,
	sequenceActivations,
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
const ACTIVATION_WIDTH = 12;
/** Each nested activation shifts right by half a bar, as in UML. */
const ACTIVATION_NEST_OFFSET = ACTIVATION_WIDTH / 2;
/** Bars reach past their call and return rows so both arrows land inside them. */
const ACTIVATION_OVERHANG = 12;

export const SEQUENCE_LIFELINE_ROLE = "sequence-lifeline";
export const SEQUENCE_ACTIVATION_ROLE = "sequence-activation";

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
 * An activation bar keeps its renderer role only while it still reads as one:
 * a bar of the renderer's width on its own lifeline, offset by whole nesting
 * steps and by no more steps than that lifeline has bars.
 */
export function isStructurallyValidSequenceActivation(
	scene: SequenceLifelineStructureScene,
	element: SequenceLifelineStructureNode,
): boolean {
	const marker = `${SEQUENCE_LIFELINE_SUFFIX}:activation:`;
	const markerIndex = element.nodeId.indexOf(marker);
	if (
		markerIndex <= 0 ||
		markerIndex + marker.length === element.nodeId.length ||
		element.id !== `node:${element.nodeId}` ||
		element.shape !== "rectangle" ||
		element.width !== ACTIVATION_WIDTH
	) {
		return false;
	}
	const lifelineNodeId = element.nodeId.slice(0, markerIndex + SEQUENCE_LIFELINE_SUFFIX.length);
	const lifeline = scene.elements.find(
		(candidate): candidate is SequenceLifelineStructureNode =>
			candidate.type === "node" &&
			candidate.id === `node:${lifelineNodeId}` &&
			candidate.nodeId === lifelineNodeId,
	);
	if (!lifeline || !isStructurallyValidSequenceLifeline(scene, lifeline)) {
		return false;
	}
	const lifelineCenter = lifeline.x + lifeline.width / 2;
	const depth = (element.x - (lifelineCenter - ACTIVATION_WIDTH / 2)) / ACTIVATION_NEST_OFFSET;
	const barsOnLifeline = scene.elements.filter(
		(candidate) =>
			candidate.type === "node" && candidate.nodeId.startsWith(`${lifelineNodeId}:activation:`),
	).length;
	return (
		depth >= -LAYOUT_ALIGNMENT_EPSILON &&
		Math.abs(depth - Math.round(depth)) <= LAYOUT_ALIGNMENT_EPSILON &&
		Math.round(depth) < barsOnLifeline &&
		element.y >= lifeline.y - LAYOUT_ALIGNMENT_EPSILON &&
		element.y + element.height <= lifeline.y + lifeline.height + LAYOUT_ALIGNMENT_EPSILON
	);
}

/**
 * Render a canonical sequence diagram: participants become ordered header
 * columns with lifelines, messages become rows in chronological order, and
 * each answered call draws an activation bar on the called lifeline. Messages
 * attach to the innermost bar active on their row, otherwise to the lifeline.
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

	const rowY = (index: number) => firstMessageY + index * MESSAGE_GAP;
	const labelById = new Map(
		input.participants.map((participant) => [participant.id, participant.label]),
	);
	const bars = sequenceActivations(input).map(
		(activation): { readonly activation: SequenceActivation; readonly node: NodeSceneElement } => {
			const nodeId = sequenceActivationId(activation.participantId, activation.callMessageId);
			const centerX = centerXByParticipant.get(activation.participantId) ?? 0;
			const top = rowY(activation.startIndex) - ACTIVATION_OVERHANG;
			return {
				activation,
				node: {
					type: "node",
					id: `node:${nodeId}`,
					nodeId,
					rendererRole: SEQUENCE_ACTIVATION_ROLE,
					shape: "rectangle",
					fillColor: input.style.backgroundColor,
					strokeColor: input.style.accentColor,
					x: centerX - ACTIVATION_WIDTH / 2 + activation.depth * ACTIVATION_NEST_OFFSET,
					y: top,
					width: ACTIVATION_WIDTH,
					height: rowY(activation.endIndex) + ACTIVATION_OVERHANG - top,
					label: `${labelById.get(activation.participantId) ?? activation.participantId} active`,
				},
			};
		},
	);
	/**
	 * Where a message meets a participant: the bar of the span it opens or
	 * closes, otherwise the innermost bar active on its row (overlapping bars
	 * never share a depth), otherwise the lifeline.
	 */
	const attachment = (participantId: string, index: number, messageId: string, towardX: number) => {
		const centerX = centerXByParticipant.get(participantId) ?? 0;
		const rightward = towardX > centerX;
		const active = bars.filter(
			({ activation }) =>
				activation.participantId === participantId &&
				activation.startIndex <= index &&
				index <= activation.endIndex,
		);
		const bar =
			active.find(
				({ activation }) =>
					activation.callMessageId === messageId || activation.returnMessageId === messageId,
			) ??
			active.reduce<(typeof bars)[number] | undefined>(
				(innermost, candidate) =>
					!innermost || candidate.activation.depth > innermost.activation.depth
						? candidate
						: innermost,
				undefined,
			);
		if (!bar) {
			return {
				nodeId: sequenceLifelineId(participantId),
				x: centerX + ((rightward ? 1 : -1) * LIFELINE_WIDTH) / 2,
			};
		}
		return {
			nodeId: bar.node.nodeId,
			x: rightward ? bar.node.x + bar.node.width : bar.node.x,
		};
	};

	const messageArrows: ArrowSceneElement[] = input.messages.map((message, index) => {
		// Validation guarantees both participants exist and differ.
		const sourceCenter = centerXByParticipant.get(message.source) ?? 0;
		const targetCenter = centerXByParticipant.get(message.target) ?? 0;
		const source = attachment(message.source, index, message.id, targetCenter);
		const target = attachment(message.target, index, message.id, sourceCenter);
		const y = rowY(index);
		return {
			type: "arrow",
			id: `arrow:${message.id}`,
			edgeId: message.id,
			sourceNodeId: source.nodeId,
			targetNodeId: target.nodeId,
			...(message.type === "return" ? { strokeColor: "#6b7280" } : {}),
			...(message.style === "dashed" || message.type === "return"
				? { strokeStyle: "dashed" as const }
				: {}),
			points: [
				{ x: source.x, y },
				{ x: target.x, y },
			],
			label: message.label,
		};
	});

	const activationBars = bars.map(({ node }) => node);
	const elements = [...messageArrows, ...lifelines, ...activationBars, ...headers, ...headerLabels];
	const zOrder = [
		...lifelines.map((element) => element.id),
		...activationBars.map((element) => element.id),
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
