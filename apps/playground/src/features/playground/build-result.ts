import {
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	BuildSequenceDiagramResultSchema,
	BuildSequenceDiagramToolInputSchema,
	RenderedDiagramSceneSchema,
	type BuildFlowchartResult,
	type BuildSequenceDiagramResult,
} from "@sketchi/diagram-agent";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { Result, Schema } from "effect";
import type { UIMessage } from "ai";
import type { ReadyPlaygroundArtifact } from "./surface";

type MessagePart = UIMessage["parts"][number];

/** A canonical build result from any Studio build tool. */
export type StudioBuildResult = BuildFlowchartResult | BuildSequenceDiagramResult;

const BUILD_TOOLS = {
	"tool-build_flowchart": {
		family: "flowchart",
		decodeResult: Schema.decodeUnknownResult(BuildFlowchartResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
				errors: "all",
				reportInput: true,
			})(input);
			return Result.isSuccess(decoded) ? decoded.success.spec.nodes.map((node) => node.label) : [];
		},
	},
	"tool-build_sequence_diagram": {
		family: "sequence",
		decodeResult: Schema.decodeUnknownResult(BuildSequenceDiagramResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildSequenceDiagramToolInputSchema, {
				errors: "all",
				reportInput: true,
			})(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.participants.map((participant) => participant.label)
				: [];
		},
	},
} as const;

export type DiagramToolPartType = keyof typeof BUILD_TOOLS;
export type DiagramToolFamily = (typeof BUILD_TOOLS)[DiagramToolPartType]["family"];

export interface DiagramToolPart {
	type: DiagramToolPartType;
	toolCallId: string;
	state: "input-streaming" | "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

export function isDiagramToolPart(part: MessagePart): part is DiagramToolPart & MessagePart {
	return Object.hasOwn(BUILD_TOOLS, part.type);
}

export function diagramToolFamily(part: DiagramToolPart): DiagramToolFamily {
	return BUILD_TOOLS[part.type].family;
}

const FAMILY_NAMES: Readonly<Record<DiagramToolFamily, string>> = {
	flowchart: "flowchart",
	sequence: "sequence diagram",
};

/**
 * The tool card heading. A call still waiting for input when its run is no
 * longer active was stopped, and never finishes drawing.
 */
export function diagramToolCardStatus(
	part: DiagramToolPart,
	active: boolean,
): { readonly stopped: boolean; readonly title: string } {
	const family = FAMILY_NAMES[diagramToolFamily(part)];
	if (part.state === "input-streaming" || part.state === "input-available") {
		if (!active) return { stopped: true, title: `Stopped drawing your ${family}` };
		return {
			stopped: false,
			title:
				part.state === "input-streaming" ? `Drawing your ${family}` : `Checking your ${family}`,
		};
	}
	if (part.state === "output-error") {
		return { stopped: false, title: "Couldn’t finish the diagram" };
	}
	return {
		stopped: false,
		title: buildResultOf(part)?.ok ? "Diagram ready" : "Diagram needs changes",
	};
}

export function buildResultOf(part: DiagramToolPart): StudioBuildResult | undefined {
	if (part.state !== "output-available") return undefined;
	const decoded: Result.Result<StudioBuildResult, unknown> = BUILD_TOOLS[part.type].decodeResult(
		part.output,
	);
	return Result.isSuccess(decoded) ? decoded.success : undefined;
}

export function artifactFromResponse(result: StudioBuildResult): ReadyPlaygroundArtifact | null {
	if (!result.ok) {
		return null;
	}
	const artifactId = result.artifact.artifactId;
	const formats = new Set(result.artifact.formats.map((format) => format.format));
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
	result: StudioBuildResult | undefined,
): RenderedDiagramScene | null {
	if (!result?.ok) {
		return null;
	}
	const scene = result.artifact.formats.find((format) => format.format === "scene")?.inline;
	return isRenderedDiagramScene(scene) ? scene : null;
}

export interface PlaygroundBuildState {
	activePart: DiagramToolPart | undefined;
	acceptedResult: StudioBuildResult | undefined;
	displayResult: StudioBuildResult | undefined;
	buildMode: boolean;
	scene: RenderedDiagramScene | null;
	artifact: ReadyPlaygroundArtifact | null;
	ghostLabels: string[];
}

export function deriveBuildState(
	messages: readonly UIMessage[],
	busy: boolean,
): PlaygroundBuildState {
	const toolParts = messages.flatMap((message) => message.parts.filter(isDiagramToolPart));
	const results = toolParts.map(buildResultOf).filter((result) => result !== undefined);
	const displayResult = results.at(-1);
	const acceptedResult = [...results].reverse().find((result) => result.ok);
	const latestAssistant = messages.findLast((message) => message.role === "assistant");
	const activePart = busy
		? latestAssistant?.parts
				.filter(isDiagramToolPart)
				.find((part) => part.state === "input-streaming" || part.state === "input-available")
		: undefined;
	const ghostLabels = activePart
		? BUILD_TOOLS[activePart.type]
				.labels(activePart.input)
				.map((label) => label.trim())
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
