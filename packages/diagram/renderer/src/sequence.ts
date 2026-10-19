import {
	canvasNodeIconBand,
	CANVAS_SPEC_VERSION,
	SEQUENCE_LIFELINE_SUFFIX,
	type SequenceActivation,
	type SequenceDiagram,
	sequenceActivationId,
	sequenceActivations,
	sequenceLifelineId,
	validateSequenceDiagram,
	estimateTextWidth,
	wrapTextToWidth,
	wrappedLabelWidth,
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
const HEADER_LABEL_PADDING = 24;
const HEADER_LABEL_WIDTH = HEADER_WIDTH - HEADER_LABEL_PADDING;
const PARTICIPANT_GAP = 140;
const MESSAGE_GAP = 88;
const MESSAGE_TOP_GAP = 64;
const LIFELINE_BOTTOM_GAP = 56;
const LIFELINE_WIDTH = 2;
const LABEL_FONT_SIZE = 14;
const LABEL_LINE_HEIGHT = 1.35;
const LABEL_VERTICAL_PADDING = 18;
const LAYOUT_ALIGNMENT_EPSILON = 0.01;
/** Participant logos match the size flowchart rectangles draw. */
const HEADER_ICON_SIZE = 28;
const ACTIVATION_WIDTH = 12;
/** Each nested activation shifts right by half a bar, as in UML. */
const ACTIVATION_NEST_OFFSET = ACTIVATION_WIDTH / 2;
/** Bars reach past their call and return rows so both arrows land inside them. */
const ACTIVATION_OVERHANG = 12;
/** Self-message labels wrap like connector labels. */
const SELF_LABEL_FONT_SIZE = 13;
const SELF_LABEL_MAX_WIDTH = 160;
/** A self-message's loop reaches this far right of its bar or lifeline. */
const SELF_LOOP_WIDTH = 32;
const SELF_LOOP_MIN_HEIGHT = 32;
/** A self-message's label sits this far right of its loop. */
const SELF_LABEL_GAP = 10;
/** A self-message's label keeps this far from the next participant's bars. */
const SELF_LABEL_CLEARANCE = 24;
/**
 * A message label centered closer than this to a lifeline it passes would sit
 * on it: connector labels wrap at 160px, a little wider for a whole long word.
 */
const PASSED_LIFELINE_CLEARANCE = 100;

/** The box the Excalidraw adapter wraps a self-message's label into. */
function selfLabelSize(label: string): { readonly width: number; readonly height: number } {
	const text = wrapTextToWidth(label, SELF_LABEL_MAX_WIDTH, SELF_LABEL_FONT_SIZE);
	return {
		width: wrappedLabelWidth(text, SELF_LABEL_FONT_SIZE, SELF_LABEL_MAX_WIDTH),
		height: Math.ceil(text.split("\n").length * SELF_LABEL_FONT_SIZE * LABEL_LINE_HEIGHT),
	};
}

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
 * A self-message loops out of its lifeline and back on its own, taller row,
 * and a self-call returns into a short bar nested inside the active one.
 */
export function renderSequenceDiagram(diagram: SequenceDiagram): RenderedDiagramScene {
	const input = validateSequenceDiagram(diagram);
	const headerLabelById = new Map(
		input.participants.map((participant) => [
			participant.id,
			wrapTextToWidth(participant.label, HEADER_LABEL_WIDTH, LABEL_FONT_SIZE),
		]),
	);
	// Whole words may wrap wider than a header; every header widens to the
	// widest label so columns stay even, and the lifelines re-space with them.
	const headerWidth = Math.max(
		HEADER_WIDTH,
		...[...headerLabelById.values()].map(
			(label) => Math.ceil(estimateTextWidth(label, LABEL_FONT_SIZE)) + HEADER_LABEL_PADDING,
		),
	);
	const columnStep = headerWidth + PARTICIPANT_GAP;
	// Size the shared header row before laying out lifelines and message lanes;
	// a participant logo sits above its label inside the header.
	const headerHeight = input.participants.reduce(
		(height, participant) =>
			Math.max(
				height,
				Math.ceil(
					(headerLabelById.get(participant.id) ?? participant.label).split("\n").length *
						LABEL_FONT_SIZE *
						LABEL_LINE_HEIGHT,
				) +
					LABEL_VERTICAL_PADDING +
					canvasNodeIconBand(
						participant.icon ? { slug: participant.icon.slug, size: HEADER_ICON_SIZE } : undefined,
					),
			),
		HEADER_HEIGHT,
	);
	const headerY = PADDING;
	const lifelineY = headerY + headerHeight;
	const firstMessageY = lifelineY + MESSAGE_TOP_GAP;
	// A self-message's row grows by its loop, which is as tall as its label.
	const selfLabels = new Map(
		input.messages.flatMap((message) =>
			message.source === message.target ? [[message.id, selfLabelSize(message.label)]] : [],
		),
	);
	const loopHeight = (messageId: string) => {
		const size = selfLabels.get(messageId);
		return size ? Math.max(SELF_LOOP_MIN_HEIGHT, size.height) : 0;
	};
	const rowYs: number[] = [];
	let nextRowY = firstMessageY;
	for (const message of input.messages) {
		rowYs.push(nextRowY);
		nextRowY += MESSAGE_GAP + loopHeight(message.id);
	}
	const lastMessage = input.messages.at(-1);
	const lastRowBottom = lastMessage
		? (rowYs.at(-1) ?? firstMessageY) + loopHeight(lastMessage.id)
		: firstMessageY;
	const lifelineHeight = lastRowBottom - lifelineY + LIFELINE_BOTTOM_GAP;

	const spans = sequenceActivations(input);
	/** Depth of the innermost bar active on a participant's row, or -1 for none. */
	const activeDepth = (participantId: string, index: number) =>
		Math.max(
			-1,
			...spans
				.filter(
					(span) =>
						span.participantId === participantId &&
						span.startIndex <= index &&
						index <= span.endIndex,
				)
				.map((span) => span.depth),
		);
	/** How far right of its lifeline a bar at this depth ends. */
	const barRight = (depth: number) =>
		depth < 0 ? LIFELINE_WIDTH / 2 : depth * ACTIVATION_NEST_OFFSET + ACTIVATION_WIDTH / 2;
	// Bars nest rightward, so a self-message deep inside them reaches further
	// right: the gap after its participant widens until its label clears the
	// next participant's bars. Diagrams without one keep even columns.
	const columnGaps = input.participants.map((participant) =>
		Math.max(
			columnStep,
			...input.messages.flatMap((message, index) => {
				const label = selfLabels.get(message.id);
				if (!label || message.source !== participant.id) return [];
				const depth = activeDepth(participant.id, index);
				const loopStart = barRight(message.type === "return" ? depth : depth + 1);
				return [
					loopStart +
						SELF_LOOP_WIDTH +
						SELF_LABEL_GAP +
						label.width +
						ACTIVATION_WIDTH / 2 +
						SELF_LABEL_CLEARANCE,
				];
			}),
		),
	);
	const centerXByParticipant = new Map<string, number>();
	const headers: NodeSceneElement[] = [];
	const headerLabels: TextSceneElement[] = [];
	const lifelines: NodeSceneElement[] = [];

	let nextCenterX = PADDING + headerWidth / 2;
	input.participants.forEach((participant, index) => {
		const centerX = nextCenterX;
		const x = centerX - headerWidth / 2;
		nextCenterX += columnGaps[index] ?? columnStep;
		centerXByParticipant.set(participant.id, centerX);
		headers.push({
			type: "node",
			id: `node:${participant.id}`,
			nodeId: participant.id,
			...(participant.kind ? { kind: participant.kind } : {}),
			...(participant.icon
				? { icon: { slug: participant.icon.slug, size: HEADER_ICON_SIZE } }
				: {}),
			shape: "rectangle",
			x,
			y: headerY,
			width: headerWidth,
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
			maxWidth: headerWidth - HEADER_LABEL_PADDING,
			// The logo sits at the top of the header; the label stacks beneath it.
			...(participant.icon ? { verticalAlign: "bottom" as const } : {}),
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

	const rowY = (index: number) => rowYs[index] ?? firstMessageY;
	const labelById = new Map(
		input.participants.map((participant) => [participant.id, participant.label]),
	);
	const barNode = (
		participantId: string,
		messageId: string,
		depth: number,
		top: number,
		bottom: number,
	): NodeSceneElement => {
		const nodeId = sequenceActivationId(participantId, messageId);
		const centerX = centerXByParticipant.get(participantId) ?? 0;
		return {
			type: "node",
			id: `node:${nodeId}`,
			nodeId,
			rendererRole: SEQUENCE_ACTIVATION_ROLE,
			shape: "rectangle",
			fillColor: input.style.backgroundColor,
			strokeColor: input.style.accentColor,
			x: centerX - ACTIVATION_WIDTH / 2 + depth * ACTIVATION_NEST_OFFSET,
			y: top,
			width: ACTIVATION_WIDTH,
			height: bottom - top,
			label: `${labelById.get(participantId) ?? participantId} active`,
		};
	};
	const bars = spans.map(
		(activation): { readonly activation: SequenceActivation; readonly node: NodeSceneElement } => ({
			activation,
			node: barNode(
				activation.participantId,
				activation.callMessageId,
				activation.depth,
				rowY(activation.startIndex) - ACTIVATION_OVERHANG,
				rowY(activation.endIndex) + ACTIVATION_OVERHANG,
			),
		}),
	);
	// A self-call returns into a short bar one step inside its innermost active
	// bar, as UML nests a participant's call to itself.
	const selfBars = new Map(
		input.messages.flatMap((message, index) => {
			if (message.source !== message.target || message.type === "return") return [];
			const depth = activeDepth(message.source, index) + 1;
			const returnY = rowY(index) + loopHeight(message.id);
			return [
				[
					message.id,
					barNode(
						message.source,
						message.id,
						depth,
						returnY - ACTIVATION_OVERHANG,
						returnY + ACTIVATION_OVERHANG,
					),
				] as const,
			];
		}),
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

	/**
	 * Excalidraw centers a bound label on a three-point arrow's middle point, and
	 * on a two-point arrow's midpoint. When that midpoint sits on a lifeline the
	 * message passes (with even columns, when it spans an even number of them),
	 * a middle point moves its label to the gap on the source side of that
	 * lifeline.
	 */
	const centers = input.participants.map(
		(participant) => centerXByParticipant.get(participant.id) ?? 0,
	);
	const labelPoint = (sourceCenter: number, targetCenter: number, y: number) => {
		const midpoint = (sourceCenter + targetCenter) / 2;
		const direction = Math.sign(targetCenter - sourceCenter);
		const passed = centers.findIndex(
			(center) =>
				Math.abs(center - midpoint) < PASSED_LIFELINE_CLEARANCE &&
				Math.min(sourceCenter, targetCenter) < center &&
				center < Math.max(sourceCenter, targetCenter),
		);
		const lifeline = centers[passed];
		const sourceSide = centers[passed - direction];
		if (lifeline === undefined || sourceSide === undefined) return [];
		return [{ x: (lifeline + sourceSide) / 2, y }];
	};

	/**
	 * A self-message leaves the right edge of its participant's innermost bar
	 * (or lifeline), runs out, down its row's loop height and back into its own
	 * bar. Excalidraw centers a bound label on its arrow's line, so the label is
	 * a free text beside the loop's outer leg, grouped with the loop, as
	 * flowcharts place their branch labels.
	 */
	const selfMessageLabels: TextSceneElement[] = [];
	const selfMessageArrow = (
		message: (typeof input.messages)[number],
		index: number,
	): ArrowSceneElement => {
		const source = attachment(message.source, index, message.id, Number.POSITIVE_INFINITY);
		const bar = selfBars.get(message.id);
		const target = bar ? { nodeId: bar.nodeId, x: bar.x + bar.width } : source;
		const outerX = Math.max(source.x, target.x) + SELF_LOOP_WIDTH;
		const top = rowY(index);
		const bottom = top + loopHeight(message.id);
		const groupIds = [`message:${message.id}`];
		selfMessageLabels.push({
			type: "text",
			id: `arrow:${message.id}:label`,
			text: message.label,
			fontSize: SELF_LABEL_FONT_SIZE,
			x: outerX + SELF_LABEL_GAP + (selfLabels.get(message.id)?.width ?? 0) / 2,
			y: (top + bottom) / 2,
			maxWidth: SELF_LABEL_MAX_WIDTH,
			groupIds,
		});
		return {
			type: "arrow",
			id: `arrow:${message.id}`,
			edgeId: message.id,
			groupIds,
			sourceNodeId: source.nodeId,
			targetNodeId: target.nodeId,
			...(message.type === "return" ? { strokeColor: "#6b7280" } : {}),
			...(message.style === "dashed" || message.type === "return"
				? { strokeStyle: "dashed" as const }
				: {}),
			points: [
				{ x: source.x, y: top },
				{ x: outerX, y: top },
				{ x: outerX, y: bottom },
				{ x: target.x, y: bottom },
			],
			label: message.label,
		};
	};

	const messageArrows: ArrowSceneElement[] = input.messages.map((message, index) => {
		if (message.source === message.target) return selfMessageArrow(message, index);
		// Validation guarantees both participants exist.
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
				...labelPoint(sourceCenter, targetCenter, y),
				{ x: target.x, y },
			],
			label: message.label,
		};
	});

	// The scene holds every self-message label beside its loop.
	const labelsRight = Math.max(
		0,
		...messageArrows.flatMap(({ edgeId, points }) => {
			const label = selfLabels.get(edgeId);
			return label && points[1] ? [points[1].x + SELF_LABEL_GAP + label.width] : [];
		}),
	);
	const activationBars = [...bars.map(({ node }) => node), ...selfBars.values()];
	const elements = [
		...messageArrows,
		...selfMessageLabels,
		...lifelines,
		...activationBars,
		...headers,
		...headerLabels,
	];
	const zOrder = [
		...lifelines.map((element) => element.id),
		...activationBars.map((element) => element.id),
		...headers.map((element) => element.id),
		...headerLabels.map((element) => element.id),
		...messageArrows.map((element) => element.id),
		...selfMessageLabels.map((element) => element.id),
	];

	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: input.id,
		title: input.title,
		width: Math.max(
			(centers.at(-1) ?? PADDING) + headerWidth / 2 + PADDING,
			Math.ceil(labelsRight) + PADDING,
		),
		height: lifelineY + lifelineHeight + PADDING,
		accentColor: input.style.accentColor,
		backgroundColor: input.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder,
	};
}
