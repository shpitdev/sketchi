import type { FlowchartDiagram, FlowchartDocument } from "@sketchi/diagram-core";

/**
 * A scenario's expected flowchart written as the document a model returns: nodes keyed by id,
 * edges as [from, to, label?], each group listing its direct members and each node naming its
 * lane. A decision whose label asks no question keeps its diamond; a node logo becomes its
 * icon, with logos on; curved lines stay curved.
 */
export function scenarioFlowchartDocument(diagram: FlowchartDiagram): FlowchartDocument {
	const members = (owner: string) => [
		...diagram.nodes.filter((node) => node.group === owner).map((node) => node.id),
		...(diagram.groups ?? []).filter((group) => group.parent === owner).map((group) => group.id),
	];
	const direction =
		diagram.layout.direction === "LR" || diagram.layout.direction === "RL" ? "LR" : "TB";
	return {
		id: diagram.id,
		title: diagram.title,
		...(direction === "LR" ? { direction } : {}),
		...(diagram.layout.edgeRouting === "curved" ? { curved: true } : {}),
		...(diagram.nodes.some((node) => node.icon) ? { logos: true } : {}),
		nodes: Object.fromEntries(
			diagram.nodes.map((node) => {
				const diamond = node.kind === "decision" && !node.label.trim().endsWith("?");
				const shape = node.shape ?? (diamond ? "diamond" : undefined);
				return [
					node.id,
					node.description || shape || node.icon || node.lane
						? {
								label: node.label,
								...(node.description ? { note: node.description } : {}),
								...(shape ? { shape } : {}),
								...(node.icon ? { icon: node.icon.slug } : {}),
								...(node.lane ? { lane: node.lane } : {}),
							}
						: node.label,
				];
			}),
		),
		edges: diagram.edges.map((edge) =>
			edge.label ? [edge.source, edge.target, edge.label] : [edge.source, edge.target],
		),
		...(diagram.groups?.length
			? {
					groups: Object.fromEntries(
						diagram.groups.map((group) => [
							group.id,
							{
								label: group.label,
								...(group.kind ? { kind: group.kind } : {}),
								contains: members(group.id),
							},
						]),
					),
				}
			: {}),
		...(diagram.lanes?.length
			? { lanes: Object.fromEntries(diagram.lanes.map((lane) => [lane.id, lane.label])) }
			: {}),
	};
}
