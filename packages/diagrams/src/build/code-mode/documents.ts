import { Effect } from "effect";
import { type FlowchartDiagram } from "../../families/flowchart/document.js";
import {
	DIAGRAM_TYPES,
	familyForType,
	type CanonicalDiagram,
	type CanonicalDiagramDocument,
	type DiagramTypeValue,
	type FamilyBuildResult,
} from "../../family.js";
import { bindBuild } from "./builds.js";
import { type CodeModeRuntimeEnvironment } from "./runtime.js";

import { type BuildOptions } from "../result.js";

import { type CodeModeArtifactStorage } from "./artifacts.js";

export function isCanonicalDocumentType(value: unknown): value is DiagramTypeValue {
	return DIAGRAM_TYPES.some((type) => type === value);
}

/** Build an authored document using the family's existing operation. */
export function buildCanonicalDocument(
	document: CanonicalDiagramDocument,
	options?: BuildOptions,
): Effect.Effect<
	FamilyBuildResult,
	import("../operation.js").BuildRejection<FamilyBuildResult>,
	CodeModeArtifactStorage | CodeModeRuntimeEnvironment
> {
	return familyForType(document.type).build({ bindBuild })({
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
			return familyForType("state-machine").toDocument(diagram);
		case "er":
			return familyForType("er").toDocument(diagram);
		case "class":
			return familyForType("class").toDocument(diagram);
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
