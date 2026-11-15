import { Effect } from "effect";
import { type FlowchartDiagram } from "../../families/flowchart/diagram.js";
import {
	DIAGRAM_TYPES,
	familyForType,
	type CanonicalDiagram,
	type CanonicalDiagramDocument,
	type DiagramTypeValue,
	type FamilyBuildResult,
} from "../../family.js";
import * as Runtime from "./runtime.js";
import { type CodeModeRuntimeEnvironment } from "./runtime.js";

import { type BuildFlowchartOptions, type WireframeComponentInput } from "./contract.js";

import { type CodeModeArtifactStorage } from "./artifacts.js";

export function isCanonicalDocumentType(value: unknown): value is DiagramTypeValue {
	return DIAGRAM_TYPES.some((type) => type === value);
}

/** Build an authored document using the family's existing operation. */
export function buildCanonicalDocument(
	document: CanonicalDiagramDocument,
	options?: BuildFlowchartOptions,
): Effect.Effect<
	FamilyBuildResult,
	import("../operation.js").BuildRejection<FamilyBuildResult>,
	CodeModeArtifactStorage | CodeModeRuntimeEnvironment
> {
	return familyForType(document.type).build(Runtime)({
		spec: document.spec,
		...(options ? { options } : {}),
	});
}

/**
 * The canonical document for a validated core diagram, for example a
 * generated candidate about to be built and persisted. A flowchart has no
 * such conversion: it is written as its document.
 */
export function canonicalDocumentFromDiagram(
	diagram: Exclude<CanonicalDiagram, FlowchartDiagram>,
): CanonicalDiagramDocument {
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
		case "chart":
			return familyForType("chart").toDocument(diagram);
		case "timeline":
			return familyForType("timeline").toDocument(diagram);
		case "mindmap":
			return {
				type: "mindmap",
				spec: {
					id: diagram.id,
					title: diagram.title,
					root: diagram.root,
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
		case "venn": {
			// CLI documents omit only the dispatch tag; the owning fields and stored wire are unchanged.
			const { type, ...spec } = diagram;
			return { type, spec };
		}
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
			return familyForType("quadrant").toDocument(diagram);
		case "sequence":
			return familyForType("sequence").toDocument(diagram);
	}
}
