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

function lifelineId(participantId: string): string {
  return `${participantId}:lifeline`;
}

/** Render a validated semantic sequence specification without graph normalization. */
export function renderSequenceDiagram(
  input: SequenceDiagramInput,
): RenderedDiagramScene {
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
      id: `node:${lifelineId(participant.id)}`,
      nodeId: lifelineId(participant.id),
      kind: "sequence-lifeline",
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
        sourceNodeId: lifelineId(message.source),
        targetNodeId: lifelineId(message.target),
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
