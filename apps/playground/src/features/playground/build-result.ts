import { sequenceBuild } from "@sketchi/diagrams/families/sequence/build";
import { familyForType } from "@sketchi/diagrams/family";
import { stateLabel } from "@sketchi/diagrams/families/state-machine/document";
import {
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	BuildStateMachineResultSchema,
	BuildStateMachineToolInputSchema,
	BuildGanttResultSchema,
	BuildGanttToolInputSchema,
	BuildErDiagramResultSchema,
	BuildErDiagramToolInputSchema,
	BuildClassDiagramResultSchema,
	BuildClassDiagramToolInputSchema,
	BuildOrgChartResultSchema,
	BuildOrgChartToolInputSchema,
	BuildJourneyMapResultSchema,
	BuildJourneyMapToolInputSchema,
	BuildSankeyResultSchema,
	BuildSankeyToolInputSchema,
	BuildWireframeResultSchema,
	BuildWireframeToolInputSchema,
	BuildQuadrantChartResultSchema,
	BuildQuadrantChartToolInputSchema,
	RenderedDiagramSceneSchema,
	type BuildFlowchartResult,
	type BuildStateMachineResult,
	type BuildGanttResult,
	type BuildErDiagramResult,
	type BuildClassDiagramResult,
	type BuildOrgChartResult,
	type BuildJourneyMapResult,
	type BuildSankeyResult,
	type BuildWireframeResult,
	type BuildQuadrantChartResult,
} from "@sketchi/diagrams/build/code-mode/contract";

import { type CanvasSpec as RenderedDiagramScene } from "@sketchi/drawing";
import { Result, Schema } from "effect";
import { type UIMessage } from "ai";
import { type ReadyPlaygroundArtifact } from "./surface";

type MessagePart = UIMessage["parts"][number];

/** A canonical build result from any Studio build tool. */
export type StudioBuildResult =
	| BuildFlowchartResult
	| ReturnType<typeof familyForType<"mindmap">>["contracts"]["output"]["Type"]
	| typeof sequenceBuild.result.Type
	| ReturnType<typeof familyForType<"timeline">>["contracts"]["output"]["Type"]
	| ReturnType<typeof familyForType<"chart">>["contracts"]["output"]["Type"]
	| BuildStateMachineResult
	| BuildGanttResult
	| BuildErDiagramResult
	| BuildClassDiagramResult
	| BuildOrgChartResult
	| ReturnType<typeof familyForType<"venn">>["contracts"]["output"]["Type"]
	| BuildJourneyMapResult
	| BuildSankeyResult
	| BuildWireframeResult
	| BuildQuadrantChartResult;

type MindmapTopic = {
	readonly label: string;
	readonly children?: readonly MindmapTopic[] | undefined;
};
const topicLabels = (topic: MindmapTopic): string[] => [
	topic.label,
	...(topic.children ?? []).flatMap(topicLabels),
];

const BUILD_TOOLS = {
	"tool-build_mindmap": {
		family: "mindmap",
		decodeResult: Schema.decodeUnknownResult(familyForType("mindmap").contracts.output),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(familyForType("mindmap").studioInput)(input);
			return Result.isSuccess(decoded) ? topicLabels(decoded.success.spec.root) : [];
		},
	},
	"tool-build_chart": {
		family: "chart",
		decodeResult: Schema.decodeUnknownResult(familyForType("chart").contracts.output),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(familyForType("chart").studioInput)(input);
			return Result.isSuccess(decoded) ? [...decoded.success.spec.categories] : [];
		},
	},
	"tool-build_timeline": {
		family: "timeline",
		decodeResult: Schema.decodeUnknownResult(familyForType("timeline").contracts.output),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(familyForType("timeline").studioInput)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.events.map((event) => event.label)
				: [];
		},
	},
	"tool-build_flowchart": {
		family: "flowchart",
		decodeResult: Schema.decodeUnknownResult(BuildFlowchartResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
				errors: "all",
				reportInput: true,
			})(input);
			return Result.isSuccess(decoded)
				? Object.values(decoded.success.spec.nodes).map((node) =>
						typeof node === "string" ? node : node.label,
					)
				: [];
		},
	},
	"tool-build_sequence_diagram": {
		family: "sequence",
		decodeResult: Schema.decodeUnknownResult(sequenceBuild.result),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(sequenceBuild.toolInput, {
				errors: "all",
				reportInput: true,
			})(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.participants.map((participant) => participant.label)
				: [];
		},
	},
	"tool-build_gantt": {
		family: "gantt",
		decodeResult: Schema.decodeUnknownResult(BuildGanttResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildGanttToolInputSchema)(input);
			return Result.isSuccess(decoded) ? decoded.success.spec.tasks.map((task) => task.label) : [];
		},
	},
	"tool-build_state_machine": {
		family: "state-machine",
		decodeResult: Schema.decodeUnknownResult(BuildStateMachineResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildStateMachineToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.states.flatMap((state) => {
						const label = stateLabel(state);
						return label === undefined ? [] : [label];
					})
				: [];
		},
	},
	"tool-build_er_diagram": {
		family: "er",
		decodeResult: Schema.decodeUnknownResult(BuildErDiagramResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildErDiagramToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.entities.map((entity) => entity.name ?? entity.id)
				: [];
		},
	},
	"tool-build_class_diagram": {
		family: "class",
		decodeResult: Schema.decodeUnknownResult(BuildClassDiagramResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildClassDiagramToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.classes.map((node) => node.name ?? node.id)
				: [];
		},
	},
	"tool-build_wireframe": {
		family: "wireframe",
		decodeResult: Schema.decodeUnknownResult(BuildWireframeResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildWireframeToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.screens.map((screen) => screen.name)
				: [];
		},
	},
	"tool-build_org_chart": {
		family: "org-chart",
		decodeResult: Schema.decodeUnknownResult(BuildOrgChartResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildOrgChartToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.people.map((person) => person.name)
				: [];
		},
	},
	"tool-build_venn_diagram": {
		family: "venn",
		decodeResult: Schema.decodeUnknownResult(familyForType("venn").contracts.output),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(familyForType("venn").studioInput)(input);
			return Result.isSuccess(decoded) ? decoded.success.spec.sets.map((set) => set.label) : [];
		},
	},
	"tool-build_journey_map": {
		family: "journey",
		decodeResult: Schema.decodeUnknownResult(BuildJourneyMapResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildJourneyMapToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.stages.flatMap((stage) => stage.steps.map((step) => step.label))
				: [];
		},
	},
	"tool-build_sankey": {
		family: "sankey",
		decodeResult: Schema.decodeUnknownResult(BuildSankeyResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildSankeyToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? Object.values(decoded.success.spec.nodes).map((node) =>
						typeof node === "string" ? node : node.label,
					)
				: [];
		},
	},
	"tool-build_quadrant_chart": {
		family: "quadrant",
		decodeResult: Schema.decodeUnknownResult(BuildQuadrantChartResultSchema),
		labels: (input: unknown) => {
			const decoded = Schema.decodeUnknownResult(BuildQuadrantChartToolInputSchema)(input);
			return Result.isSuccess(decoded)
				? decoded.success.spec.points.map((point) => point.label)
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
	mindmap: "mindmap",
	sequence: "sequence diagram",
	timeline: "timeline",
	chart: "chart",
	"state-machine": "state machine",
	gantt: "Gantt chart",
	er: "ER diagram",
	class: "class diagram",
	"org-chart": "org chart",
	venn: "Venn diagram",
	journey: "journey map",
	sankey: "Sankey diagram",
	wireframe: "wireframe",
	quadrant: "quadrant chart",
};

/**
 * The tool card heading, and whether the call is still being written or
 * checked. A call still waiting for input when its run is no longer active was
 * stopped, and never finishes drawing.
 */
export function diagramToolCardStatus(
	part: DiagramToolPart,
	active: boolean,
): { readonly stopped: boolean; readonly title: string; readonly writing: boolean } {
	const family = FAMILY_NAMES[diagramToolFamily(part)];
	if (part.state === "input-streaming" || part.state === "input-available") {
		if (!active) return { stopped: true, title: `Stopped drawing your ${family}`, writing: false };
		return {
			stopped: false,
			title:
				part.state === "input-streaming" ? `Drawing your ${family}` : `Checking your ${family}`,
			writing: true,
		};
	}
	if (part.state === "output-error") {
		return { stopped: false, title: "Couldn’t finish the diagram", writing: false };
	}
	return {
		stopped: false,
		title: buildResultOf(part)?.ok ? "Diagram ready" : "Diagram needs changes",
		writing: false,
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
