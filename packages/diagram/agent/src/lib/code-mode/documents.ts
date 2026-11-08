import {
	type CanonicalDiagram,
	DIAGRAM_TYPES,
	type DiagramTypeValue,
	FLOWCHART_ID_PATTERN,
	type FlowchartDiagram,
} from "@sketchi/diagram-core";
import type { Effect } from "effect";

import {
	type BuildChartResult,
	type BuildGanttResult,
	type BuildFlowchartOptions,
	type BuildFlowchartResult,
	type BuildMindmapResult,
	type BuildSequenceDiagramResult,
	type BuildStateMachineResult,
	type BuildErDiagramResult,
	type BuildClassDiagramResult,
	type BuildOrgChartResult,
	type BuildVennDiagramResult,
	type BuildJourneyMapResult,
	type BuildSankeyResult,
	type BuildWireframeResult,
	type BuildQuadrantChartResult,
	type BuildTimelineResult,
	ClassSpec,
	ErSpec,
	FlowchartSpec,
	MindmapSpec,
	type MindmapTopicInput,
	SequenceDiagramSpec,
	StateMachineSpec,
	TimelineSpec,
	ChartSpec,
	GanttSpec,
	OrgChartSpec,
	VennSpec,
	JourneySpec,
	SankeySpec,
	WireframeSpec,
	type WireframeComponentInput,
	QuadrantChartSpec,
} from "./contract.js";
import type { CodeModeArtifactStorage } from "./artifacts.js";
import {
	buildFlowchart,
	buildMindmap,
	buildSequenceDiagram,
	buildStateMachine,
	buildErDiagram,
	buildClassDiagram,
	buildOrgChart,
	buildVennDiagram,
	buildJourneyMap,
	buildSankey,
	buildWireframe,
	buildQuadrantChart,
	buildTimeline,
	buildChart,
	buildGantt,
	type CodeModeRuntimeEnvironment,
} from "./runtime.js";

/** Every canonical family has one Code Mode document type. */
export const CANONICAL_DOCUMENT_TYPES = DIAGRAM_TYPES;

/** The Code Mode authoring spec each canonical family's document carries. */
export const CANONICAL_DOCUMENT_SPECS = {
	flowchart: FlowchartSpec,
	mindmap: MindmapSpec,
	sequence: SequenceDiagramSpec,
	timeline: TimelineSpec,
	chart: ChartSpec,
	"state-machine": StateMachineSpec,
	gantt: GanttSpec,
	er: ErSpec,
	class: ClassSpec,
	"org-chart": OrgChartSpec,
	venn: VennSpec,
	journey: JourneySpec,
	sankey: SankeySpec,
	wireframe: WireframeSpec,
	quadrant: QuadrantChartSpec,
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
	| BuildSequenceDiagramResult
	| BuildTimelineResult
	| BuildChartResult
	| BuildStateMachineResult
	| BuildGanttResult
	| BuildErDiagramResult
	| BuildClassDiagramResult
	| BuildOrgChartResult
	| BuildVennDiagramResult
	| BuildJourneyMapResult
	| BuildSankeyResult
	| BuildWireframeResult
	| BuildQuadrantChartResult;

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
		case "timeline":
			return buildTimeline(request);
		case "chart":
			return buildChart(request);
		case "state-machine":
			return buildStateMachine(request);
		case "gantt":
			return buildGantt(request);
		case "er":
			return buildErDiagram(request);
		case "class":
			return buildClassDiagram(request);
		case "org-chart":
			return buildOrgChart(request);
		case "venn":
			return buildVennDiagram(request);
		case "journey":
			return buildJourneyMap(request);
		case "sankey":
			return buildSankey(request);
		case "wireframe":
			return buildWireframe(request);
		case "quadrant":
			return buildQuadrantChart(request);
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
/** The document id each id of a generated flowchart's nodes, groups and lanes becomes. */
export interface FlowchartDocumentIds {
	readonly nodes: ReadonlyMap<string, string>;
	readonly groups: ReadonlyMap<string, string>;
	readonly lanes: ReadonlyMap<string, string>;
}

/**
 * A generated flowchart's ids as its document keys them: each id that fits the
 * document's pattern and is free stays as written, and any other is made from it
 * ("Hiring manager" becomes "hiring-manager"), unique across nodes, groups and lanes.
 */
export function flowchartDocumentIds(diagram: FlowchartDiagram): FlowchartDocumentIds {
	const kinds = [
		["node", diagram.nodes.map((node) => node.id)],
		["group", (diagram.groups ?? []).map((group) => group.id)],
		["lane", (diagram.lanes ?? []).map((lane) => lane.id)],
	] as const;
	const taken = new Set<string>();
	const maps = {
		node: new Map<string, string>(),
		group: new Map<string, string>(),
		lane: new Map<string, string>(),
	};
	for (const [kind, ids] of kinds)
		for (const id of ids)
			if (FLOWCHART_ID_PATTERN.test(id) && !taken.has(id) && !maps[kind].has(id)) {
				taken.add(id);
				maps[kind].set(id, id);
			}
	for (const [kind, ids] of kinds)
		for (const id of ids) {
			if (maps[kind].has(id)) continue;
			const slug = id
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/gu, "-")
				.replace(/^[^a-z]+/u, "")
				.replace(/-+$/u, "");
			const base = slug || kind;
			let next = base;
			for (let suffix = 2; taken.has(next); suffix += 1) next = `${base}-${suffix}`;
			taken.add(next);
			maps[kind].set(id, next);
		}
	return { nodes: maps.node, groups: maps.group, lanes: maps.lane };
}

export function canonicalDocumentFromDiagram(diagram: CanonicalDiagram): CanonicalDiagramDocument {
	switch (diagram.type) {
		case "gantt": {
			const { type: _type, ...spec } = diagram;
			return {
				type: "gantt",
				spec: {
					...spec,
					tasks: spec.tasks.map((task) => ({
						...task,
						...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
					})),
					...(spec.phases ? { phases: [...spec.phases] } : {}),
				},
			};
		}
		case "chart": {
			const { type: _type, ...spec } = diagram;
			return {
				type: "chart",
				spec: {
					...spec,
					categories: [...spec.categories],
					series: spec.series.map((series) => ({ ...series, values: [...series.values] })),
				},
			};
		}
		case "timeline":
			return {
				type: "timeline",
				spec: {
					id: diagram.id,
					title: diagram.title,
					events: diagram.events.map((event) => ({ ...event })),
					...(diagram.lanes ? { lanes: [...diagram.lanes] } : {}),
					...(diagram.today ? { today: diagram.today } : {}),
					style: diagram.style,
				},
			};
		case "flowchart": {
			// A generated flowchart arrives as the drawing's own graph; its document lists
			// each container's direct members and keys nodes by id.
			const ids = flowchartDocumentIds(diagram);
			const node = (id: string) => ids.nodes.get(id) ?? id;
			const group = (id: string) => ids.groups.get(id) ?? id;
			const members = (owner: string) => [
				...diagram.nodes.filter((entry) => entry.group === owner).map((entry) => node(entry.id)),
				...(diagram.groups ?? [])
					.filter((entry) => entry.parent === owner)
					.map((entry) => group(entry.id)),
			];
			return {
				type: "flowchart",
				spec: {
					id: diagram.id,
					title: diagram.title,
					direction:
						diagram.layout.direction === "LR" || diagram.layout.direction === "RL" ? "LR" : "TB",
					...(diagram.nodes.some((entry) => entry.icon) ? { logos: true } : {}),
					nodes: Object.fromEntries(
						diagram.nodes.map((entry) => {
							// A decision whose label asks no question keeps its diamond.
							const diamond = entry.kind === "decision" && !entry.label.trim().endsWith("?");
							const shape = entry.shape ?? (diamond ? "diamond" : undefined);
							return [
								node(entry.id),
								entry.description || shape || entry.icon
									? {
											label: entry.label,
											...(entry.description ? { note: entry.description } : {}),
											...(shape ? { shape } : {}),
											...(entry.icon ? { icon: entry.icon.slug } : {}),
										}
									: entry.label,
							];
						}),
					),
					edges: diagram.edges.map((edge) =>
						edge.label
							? [node(edge.source), node(edge.target), edge.label]
							: [node(edge.source), node(edge.target)],
					),
					...(diagram.groups?.length
						? {
								groups: Object.fromEntries(
									diagram.groups.map((entry) => [
										group(entry.id),
										{
											label: entry.label,
											...(entry.kind ? { kind: entry.kind } : {}),
											contains: members(entry.id),
										},
									]),
								),
							}
						: {}),
					...(diagram.lanes?.length
						? {
								lanes: Object.fromEntries(
									diagram.lanes.map((lane) => [
										ids.lanes.get(lane.id) ?? lane.id,
										{
											label: lane.label,
											contains: diagram.nodes
												.filter((entry) => entry.lane === lane.id)
												.map((entry) => node(entry.id)),
										},
									]),
								),
							}
						: {}),
				},
			};
		}
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
		case "state-machine":
			return {
				type: "state-machine",
				spec: {
					id: diagram.id,
					title: diagram.title,
					initial: diagram.initial,
					states: diagram.states.map((state) => ({ ...state })),
					transitions: diagram.transitions.map((transition) => ({ ...transition })),
					...(diagram.layout ? { layout: { direction: diagram.layout.direction } } : {}),
					style: diagram.style,
				},
			};
		case "er":
			return {
				type: "er",
				spec: {
					id: diagram.id,
					title: diagram.title,
					entities: diagram.entities.map((entity) => ({
						...entity,
						fields: entity.fields.map((field) => ({ ...field })),
					})),
					relationships: diagram.relationships.map((relationship) => ({ ...relationship })),
					style: diagram.style,
				},
			};
		case "class":
			return {
				type: "class",
				spec: {
					id: diagram.id,
					title: diagram.title,
					classes: diagram.classes.map((node) => ({
						...node,
						attributes: node.attributes.map((attribute) => ({ ...attribute })),
						methods: node.methods.map((method) => ({
							...method,
							params: method.params.map((param) => ({ ...param })),
						})),
					})),
					relationships: diagram.relationships.map((relationship) => ({ ...relationship })),
					style: diagram.style,
				},
			};
		case "sankey":
			return {
				type: "sankey",
				spec: {
					id: diagram.id,
					title: diagram.title,
					nodes: diagram.nodes.map((node) => ({ ...node })),
					links: diagram.links.map((link) => ({ ...link })),
					...(diagram.unit === undefined ? {} : { unit: diagram.unit }),
					style: diagram.style,
				},
			};
		case "org-chart":
			return {
				type: "org-chart",
				spec: {
					id: diagram.id,
					title: diagram.title,
					people: diagram.people.map((person) => ({ ...person })),
					dottedLines: diagram.dottedLines.map((line) => ({ ...line })),
					...(diagram.groupByDepartment === undefined
						? {}
						: { groupByDepartment: diagram.groupByDepartment }),
					...(diagram.forest === undefined ? {} : { forest: diagram.forest }),
					style: diagram.style,
				},
			};
		case "venn":
			return {
				type: "venn",
				spec: {
					id: diagram.id,
					title: diagram.title,
					sets: diagram.sets.map((set) => ({ ...set })),
					regions: diagram.regions.map((region) => ({
						...region,
						sets: [...region.sets],
						...(region.items === undefined ? {} : { items: [...region.items] }),
					})),
					style: diagram.style,
				},
			};
		case "journey":
			return {
				type: "journey",
				spec: {
					id: diagram.id,
					title: diagram.title,
					...(diagram.persona === undefined ? {} : { persona: diagram.persona }),
					...(diagram.actors === undefined ? {} : { actors: [...diagram.actors] }),
					stages: diagram.stages.map((stage) => ({
						name: stage.name,
						steps: stage.steps.map((step) => ({ ...step })),
						...(stage.painPoints === undefined ? {} : { painPoints: [...stage.painPoints] }),
						...(stage.opportunities === undefined
							? {}
							: { opportunities: [...stage.opportunities] }),
					})),
					style: diagram.style,
				},
			};
		case "wireframe":
			return {
				type: "wireframe",
				spec: {
					id: diagram.id,
					title: diagram.title,
					screens: diagram.screens.map((screen) => ({
						id: screen.id,
						name: screen.name,
						device: screen.device,
						...(screen.align === undefined ? {} : { align: screen.align }),
						children: screen.children.map(
							(component) => structuredClone(component) as WireframeComponentInput,
						),
					})),
					style: diagram.style,
				},
			};
		case "quadrant":
			return {
				type: "quadrant",
				spec: {
					id: diagram.id,
					title: diagram.title,
					xAxis: { ...diagram.xAxis },
					yAxis: { ...diagram.yAxis },
					quadrants: { ...diagram.quadrants },
					points: diagram.points.map((point) => ({ ...point })),
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
