import {
	flowchartDiagramFromDocument,
	flowchartDocumentId,
	flowchartNodeDetails,
	type FlowchartDiagram,
	type FlowchartDocumentEdge,
	type FlowchartDocumentNode,
	type FlowchartEdgeEnd,
} from "@sketchi/diagram-core";

import type { FlowchartSpec, NormalizedFlowchartSpec } from "../code-mode/contract.js";
import { cleanToolString } from "../clean-tool-string.js";

function cleanOptional(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const cleaned = cleanToolString(value);
	return cleaned.length > 0 ? cleaned : undefined;
}

function cleanNode(node: FlowchartDocumentNode): FlowchartDocumentNode {
	if (typeof node === "string") return cleanToolString(node);
	const details = flowchartNodeDetails(node);
	const note = cleanOptional(details.note);
	return {
		label: cleanToolString(details.label),
		...(note ? { note } : {}),
		...(details.shape ? { shape: details.shape } : {}),
		...(details.icon === null
			? { icon: null }
			: details.icon
				? { icon: cleanToolString(details.icon) }
				: {}),
	};
}

const cleanEnd = (end: FlowchartEdgeEnd): FlowchartEdgeEnd =>
	typeof end === "string" ? cleanToolString(end) : end.map((id) => cleanToolString(id));

function cleanEdge([from, to, label]: FlowchartDocumentEdge): FlowchartDocumentEdge {
	const cleaned = cleanOptional(label);
	return cleaned === undefined
		? [cleanEnd(from), cleanEnd(to)]
		: [cleanEnd(from), cleanEnd(to), cleaned];
}

const cleanContainers = <
	C extends { readonly label: string; readonly contains: readonly string[] },
>(
	containers: Readonly<Record<string, C>> | undefined,
): Record<string, C> | undefined =>
	containers === undefined
		? undefined
		: Object.fromEntries(
				Object.entries(containers).map(([id, container]) => [
					cleanToolString(id),
					{
						...container,
						label: cleanToolString(container.label),
						contains: container.contains.map((member) => cleanToolString(member)),
					},
				]),
			);

/**
 * The document as a build reads it: every string cleaned of tool-output debris, the id
 * taken from the title when absent, and the direction filled in.
 */
export function normalizeFlowchartSpec(spec: FlowchartSpec): NormalizedFlowchartSpec {
	const title = cleanToolString(spec.title);
	const id = cleanOptional(spec.id);
	const groups = cleanContainers(spec.groups);
	const lanes = cleanContainers(spec.lanes);
	return {
		id: flowchartDocumentId({ title, ...(id ? { id } : {}) }),
		title,
		direction: spec.direction ?? "TB",
		...(spec.logos === undefined ? {} : { logos: spec.logos }),
		nodes: Object.fromEntries(
			Object.entries(spec.nodes).map(([nodeId, node]) => [
				cleanToolString(nodeId),
				cleanNode(node),
			]),
		),
		edges: spec.edges.map(cleanEdge),
		...(groups ? { groups } : {}),
		...(lanes ? { lanes } : {}),
	};
}

/**
 * The drawing a curated, non-persisting view renders: a valid document only, each
 * node icon read as the catalog slug it names, without a catalog lookup.
 */
export function flowchartDiagramFromSpec(spec: FlowchartSpec): FlowchartDiagram {
	const normalized = normalizeFlowchartSpec(spec);
	const nodeIcons = new Map(
		Object.entries(normalized.nodes).flatMap(([id, node]) =>
			typeof node !== "string" && typeof node.icon === "string"
				? [[id, node.icon.toLowerCase()] as const]
				: [],
		),
	);
	const built = flowchartDiagramFromDocument(normalized, { nodeIcons });
	if (!built.ok) throw new Error(built.issues.map((issue) => issue.message).join("\n"));
	return built.diagram;
}
