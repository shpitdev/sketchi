import type {
  ArrowSceneElement,
  NodeSceneElement,
  RenderedDiagramScene,
  TextSceneElement,
} from "./scene.js";

export interface SequenceParticipant {
  readonly id: string;
  readonly label: string;
  readonly kind?: string | undefined;
}

export interface SequenceMessage {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly type?: string | undefined;
  readonly style?: string | undefined;
}

export interface SequenceDiagramInput {
  readonly id: string;
  readonly title: string;
  readonly participants: readonly SequenceParticipant[];
  readonly messages: readonly SequenceMessage[];
  readonly style: {
    readonly accentColor: string;
    readonly backgroundColor: string;
  };
}

const PADDING = 48;
const HEADER_WIDTH = 180;
const HEADER_HEIGHT = 72;
const PARTICIPANT_GAP = 140;
const MESSAGE_GAP = 88;
const MESSAGE_TOP_GAP = 64;
const LIFELINE_BOTTOM_GAP = 56;
const LIFELINE_WIDTH = 2;
const LABEL_FONT_SIZE = 14;

export const SEQUENCE_LIFELINE_ROLE = "sequence-lifeline";

export function sequenceLifelineId(participantId: string): string {
  return `${participantId}:lifeline`;
}

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
    | { readonly type: "arrow" | "text"; readonly id: string }
  )[];
}

export function isStructurallyValidSequenceLifeline(
  scene: SequenceLifelineStructureScene,
  element: SequenceLifelineStructureNode,
): boolean {
  const suffix = ":lifeline";
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
    element.x + element.width / 2 === header.x + header.width / 2 &&
    element.y >= header.y + header.height
  );
}

/** Render a validated semantic sequence specification without graph normalization. */
export function renderSequenceDiagram(
  input: SequenceDiagramInput,
): RenderedDiagramScene {
  const participantIds = new Set(
    input.participants.map((participant) => participant.id),
  );
  for (const participant of input.participants) {
    const generatedLifelineId = sequenceLifelineId(participant.id);
    if (participantIds.has(generatedLifelineId)) {
      throw new Error(
        `Sequence participant "${generatedLifelineId}" collides with the generated lifeline for "${participant.id}".`,
      );
    }
  }

  const columnStep = HEADER_WIDTH + PARTICIPANT_GAP;
  const headerY = PADDING;
  const lifelineY = headerY + HEADER_HEIGHT;
  const firstMessageY = lifelineY + MESSAGE_TOP_GAP;
  const lastMessageY =
    firstMessageY + Math.max(0, input.messages.length - 1) * MESSAGE_GAP;
  const lifelineHeight =
    Math.max(firstMessageY, lastMessageY) - lifelineY + LIFELINE_BOTTOM_GAP;
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
      height: HEADER_HEIGHT,
      label: participant.label,
    });
    headerLabels.push({
      type: "text",
      id: `label:${participant.id}`,
      containerId: `node:${participant.id}`,
      x: centerX,
      y: headerY + HEADER_HEIGHT / 2,
      text: participant.label,
      fontSize: LABEL_FONT_SIZE,
      maxWidth: HEADER_WIDTH - 24,
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

  const messageArrows: ArrowSceneElement[] = input.messages.map(
    (message, index) => {
      const sourceX = centerXByParticipant.get(message.source);
      const targetX = centerXByParticipant.get(message.target);
      if (sourceX === undefined || targetX === undefined) {
        throw new Error(
          `Sequence message "${message.id}" references an unknown participant.`,
        );
      }
      if (sourceX === targetX) {
        throw new Error(
          `Sequence message "${message.id}" cannot target its source participant.`,
        );
      }
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
    },
  );

  return {
    diagramId: input.id,
    title: input.title,
    width:
      PADDING * 2 +
      HEADER_WIDTH +
      Math.max(0, input.participants.length - 1) * columnStep,
    height: lifelineY + lifelineHeight + PADDING,
    accentColor: input.style.accentColor,
    backgroundColor: input.style.backgroundColor,
    elements: [...messageArrows, ...lifelines, ...headers, ...headerLabels],
  };
}
