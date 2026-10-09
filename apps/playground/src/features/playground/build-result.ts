import {
  BuildFlowchartRequestSchema,
  BuildFlowchartResultSchema,
  RenderedDiagramSceneSchema,
  type BuildFlowchartResult,
} from "@sketchi/diagram-agent";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { Result, Schema } from "effect";
import type { UIMessage } from "ai";
import type { ReadyPlaygroundArtifact } from "./surface";

type MessagePart = UIMessage["parts"][number];

export interface FlowchartToolPart {
  type: "tool-build_flowchart";
  toolCallId: string;
  state:
    "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function isFlowchartToolPart(
  part: MessagePart,
): part is FlowchartToolPart & MessagePart {
  return part.type === "tool-build_flowchart";
}

const decodeBuildResult = Schema.decodeUnknownResult(
  BuildFlowchartResultSchema,
);

export function buildResultOf(
  part: FlowchartToolPart,
): BuildFlowchartResult | undefined {
  if (part.state !== "output-available") return undefined;
  const decoded = decodeBuildResult(part.output);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

export function artifactFromResponse(
  result: BuildFlowchartResult,
): ReadyPlaygroundArtifact | null {
  if (!result.ok) {
    return null;
  }
  const artifactId = result.artifact.artifactId;
  const formats = new Set(
    result.artifact.formats.map((format) => format.format),
  );
  if (!formats.has("scene") || !formats.has("excalidraw")) {
    return null;
  }
  const encoded = encodeURIComponent(artifactId);

  return {
    artifactId,
    exportUrls: {
      excalidraw: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
      scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
    },
    editUrl: `/artifacts/${encoded}/edit`,
    viewUrl: `/artifacts/${encoded}`,
  };
}

function isRenderedDiagramScene(value: unknown): value is RenderedDiagramScene {
  return Result.isSuccess(
    Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
      errors: "all",
      reportInput: true,
    })(value),
  );
}

export function sceneFromResult(
  result: BuildFlowchartResult | undefined,
): RenderedDiagramScene | null {
  if (!result?.ok) {
    return null;
  }
  const scene = result.artifact.formats.find(
    (format) => format.format === "scene",
  )?.inline;
  return isRenderedDiagramScene(scene) ? scene : null;
}

export interface PlaygroundBuildState {
  activePart: FlowchartToolPart | undefined;
  acceptedResult: BuildFlowchartResult | undefined;
  displayResult: BuildFlowchartResult | undefined;
  buildMode: boolean;
  scene: RenderedDiagramScene | null;
  artifact: ReadyPlaygroundArtifact | null;
  ghostLabels: string[];
}

export function deriveBuildState(
  messages: readonly UIMessage[],
  busy: boolean,
): PlaygroundBuildState {
  const toolParts = messages.flatMap((message) =>
    message.parts.filter(isFlowchartToolPart),
  );
  const results = toolParts
    .map(buildResultOf)
    .filter((result) => result !== undefined);
  const displayResult = results.at(-1);
  const acceptedResult = [...results].reverse().find((result) => result.ok);
  const latestAssistant = messages.findLast(
    (message) => message.role === "assistant",
  );
  const activePart = busy
    ? latestAssistant?.parts
        .filter(isFlowchartToolPart)
        .find(
          (part) =>
            part.state === "input-streaming" ||
            part.state === "input-available",
        )
    : undefined;
  const input = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
    errors: "all",
    reportInput: true,
  })(activePart?.input);
  const ghostLabels = Result.isSuccess(input)
    ? input.success.spec.nodes
        .map((node) => node.label.trim())
        .filter((label) => label.length > 0)
        .slice(0, 24)
    : [];
  return {
    buildMode: toolParts.length > 0,
    displayResult,
    acceptedResult,
    activePart,
    scene: sceneFromResult(acceptedResult),
    artifact: acceptedResult ? artifactFromResponse(acceptedResult) : null,
    ghostLabels,
  };
}
