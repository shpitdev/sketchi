/** Resolves authored Flowchart drawing choices before the shared geometry engine. */
import { type CanvasShapeKind, type CanvasSpec } from "@sketchi/drawing";
import { type GraphInput } from "../../graph/input";
import { renderGraphDiagram } from "../../graph/scene";
import { FLOWCHART_NODE_COLORS, type FlowchartDiagram, type FlowchartNodeShape } from "./document";

const SHAPES: Readonly<Record<FlowchartNodeShape, CanvasShapeKind>> = {
	database: "cylinder",
	queue: "pipe",
	document: "document",
	storage: "bucket",
};

export function renderFlowchartDiagram(diagram: FlowchartDiagram): CanvasSpec {
	const graph: GraphInput = {
		nodes: diagram.nodes.map((node) => ({
			id: node.id,
			label: node.label,
			kind: node.kind,
			shape: node.shape
				? SHAPES[node.shape]
				: node.kind === "decision"
					? "diamond"
					: node.kind === "start" || node.kind === "end"
						? "ellipse"
						: "rectangle",
			...(node.description ? { description: node.description } : {}),
			...(node.group ? { group: node.group } : {}),
			...(node.lane ? { lane: node.lane } : {}),
			...(node.icon ? { icon: node.icon } : {}),
			...(node.color
				? {
						paint: {
							strokeColor: FLOWCHART_NODE_COLORS[node.color].stroke,
							fillColor: FLOWCHART_NODE_COLORS[node.color].fill,
							fillStyle: "solid" as const,
						},
					}
				: {}),
		})),
		edges: diagram.edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			...(edge.label === undefined ? {} : { label: edge.label }),
		})),
		...(diagram.groups ? { groups: diagram.groups } : {}),
		...(diagram.lanes ? { lanes: diagram.lanes } : {}),
		layout: diagram.layout,
	};
	return renderGraphDiagram(graph, diagram);
}
