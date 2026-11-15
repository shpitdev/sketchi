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

import { type BuildFlowchartOptions } from "./contract.js";

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
		case "gantt":
			return familyForType("gantt").toDocument(diagram);
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
		case "org-chart":
			return familyForType("org-chart").toDocument(diagram);
		case "venn": {
			// CLI documents omit only the dispatch tag; the owning fields and stored wire are unchanged.
			const { type, ...spec } = diagram;
			return { type, spec };
		}
		case "sankey":
			return familyForType("sankey").toDocument(diagram);
		case "journey":
			return familyForType("journey").toDocument(diagram);
		case "wireframe":
			return familyForType("wireframe").toDocument(diagram);
		case "quadrant":
			return familyForType("quadrant").toDocument(diagram);
		case "sequence":
			return familyForType("sequence").toDocument(diagram);
	}
}
