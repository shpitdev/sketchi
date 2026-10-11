import { type CanonicalDiagram, DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import type { Effect } from "effect";

import {
	type BuildFlowchartOptions,
	type BuildFlowchartResult,
	type BuildMindmapResult,
	type BuildSequenceDiagramResult,
	FlowchartSpec,
	MindmapSpec,
	type MindmapTopicInput,
	SequenceDiagramSpec,
} from "./contract.js";
import type { CodeModeArtifactStorage } from "./artifacts.js";
import {
	buildFlowchart,
	buildMindmap,
	buildSequenceDiagram,
	type CodeModeRuntimeEnvironment,
} from "./runtime.js";

/** Every canonical family has one Code Mode document type. */
export const CANONICAL_DOCUMENT_TYPES = DIAGRAM_TYPES;

/** The Code Mode authoring spec each canonical family's document carries. */
export const CANONICAL_DOCUMENT_SPECS = {
	flowchart: FlowchartSpec,
	mindmap: MindmapSpec,
	sequence: SequenceDiagramSpec,
} as const satisfies Record<DiagramTypeValue, unknown>;

/** A canonical diagram document: a family and its authoring spec. */
export type CanonicalDiagramDocument = {
	readonly [Type in DiagramTypeValue]: {
		readonly type: Type;
		readonly spec: (typeof CANONICAL_DOCUMENT_SPECS)[Type]["Type"];
	};
}[DiagramTypeValue];

export type CanonicalBuildResult =
	| BuildFlowchartResult
	| BuildMindmapResult
	| BuildSequenceDiagramResult;

export function isCanonicalDocumentType(value: unknown): value is DiagramTypeValue {
	return CANONICAL_DOCUMENT_TYPES.some((type) => type === value);
}

/** Build a canonical document with its family's Code Mode operation. */
export function buildCanonicalDocument(
	document: CanonicalDiagramDocument,
	options?: BuildFlowchartOptions,
): Effect.Effect<
	CanonicalBuildResult,
	never,
	CodeModeArtifactStorage | CodeModeRuntimeEnvironment
> {
	const request = { spec: document.spec, ...(options ? { options } : {}) };
	switch (document.type) {
		case "flowchart":
			return buildFlowchart(request);
		case "mindmap":
			return buildMindmap(request);
		case "sequence":
			return buildSequenceDiagram(request);
	}
}

function mindmapRoot(diagram: Extract<CanonicalDiagram, { type: "mindmap" }>): MindmapTopicInput {
	const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
	const children = new Map<string, (typeof diagram.edges)[number][]>();
	for (const edge of diagram.edges) {
		children.set(edge.source, [...(children.get(edge.source) ?? []), edge]);
	}
	const topic = (nodeId: string): MindmapTopicInput => {
		const nested = [...(children.get(nodeId) ?? [])]
			.sort((left, right) => left.metadata.siblingIndex - right.metadata.siblingIndex)
			.map((edge) => topic(edge.target));
		return {
			label: nodes.get(nodeId)?.label ?? nodeId,
			...(nested.length > 0 ? { children: nested } : {}),
		};
	};
	const root = diagram.nodes.find((node) => node.kind === "root") ?? diagram.nodes[0];
	return topic(root?.id ?? "");
}

/**
 * The canonical document for a validated core diagram, for example a
 * generated candidate about to be built and persisted.
 */
export function canonicalDocumentFromDiagram(diagram: CanonicalDiagram): CanonicalDiagramDocument {
	switch (diagram.type) {
		case "flowchart":
			return {
				type: "flowchart",
				spec: {
					id: diagram.id,
					title: diagram.title,
					nodes: diagram.nodes.map((node) => ({
						id: node.id,
						label: node.label,
						kind: node.kind,
						...(node.description ? { description: node.description } : {}),
						...(node.icon ? { icon: { slug: node.icon.slug } } : {}),
					})),
					edges: diagram.edges.map((edge) => ({
						id: edge.id,
						source: edge.source,
						target: edge.target,
						...(edge.label ? { label: edge.label } : {}),
					})),
					layout: {
						direction:
							diagram.layout.direction === "LR" || diagram.layout.direction === "RL" ? "LR" : "TB",
					},
					style: diagram.style,
				},
			};
		case "mindmap":
			return {
				type: "mindmap",
				spec: {
					id: diagram.id,
					title: diagram.title,
					root: mindmapRoot(diagram),
					layout: { direction: diagram.layout.direction === "RL" ? "RL" : "LR" },
					style: diagram.style,
				},
			};
		case "sequence":
			return {
				type: "sequence",
				spec: {
					id: diagram.id,
					title: diagram.title,
					participants: diagram.participants.map((participant) => ({
						id: participant.id,
						label: participant.label,
						...(participant.kind ? { kind: participant.kind } : {}),
						...(participant.icon ? { icon: { slug: participant.icon.slug } } : {}),
					})),
					messages: diagram.messages.map((message) => ({
						id: message.id,
						source: message.source,
						target: message.target,
						label: message.label,
						...(message.type ? { type: message.type } : {}),
						...(message.style ? { style: message.style } : {}),
					})),
					style: diagram.style,
				},
			};
	}
}
