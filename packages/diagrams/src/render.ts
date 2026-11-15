import { Result, Schema } from "effect";
import {
	type CanonicalValidationError,
	type CanonicalDiagram,
	CanonicalDiagramSchema,
} from "./diagram.js";

import { renderChartDiagram } from "./families/chart/render.js";
import { renderGanttDiagram } from "./families/gantt/render.js";
import { renderTimelineDiagram } from "./families/timeline/render.js";

import { renderMindmap } from "./families/mindmap/index.js";
import { renderIntermediateDiagram } from "./graph/scene.js";
import { type CanvasSpec as RenderedDiagramScene } from "@sketchi/drawing";
import { renderSequenceDiagram } from "./families/sequence/render.js";
import { renderStateMachineDiagram } from "./families/state-machine/render.js";
import { renderErDiagram } from "./families/er/render.js";
import { renderClassDiagram } from "./families/class/diagram.js";
import { renderOrgChartDiagram } from "./families/org-chart/render.js";
import { renderVennDiagram } from "./families/venn/render.js";
import { renderJourneyDiagram } from "./families/journey/render.js";
import { renderSankeyDiagram } from "./families/sankey/render.js";
import { renderWireframeDiagram } from "./families/wireframe/render.js";
import { renderQuadrantDiagram } from "./families/quadrant/render.js";

/** Render any canonical diagram with its family's renderer. */
export function renderDiagram(
	diagram: CanonicalDiagram,
): Result.Result<RenderedDiagramScene, CanonicalValidationError | Schema.SchemaError> {
	return CanonicalDiagramSchema.match(diagram, {
		flowchart: renderIntermediateDiagram,
		mindmap: (document) => Result.succeed(renderMindmap(document)),
		sequence: renderSequenceDiagram,
		timeline: renderTimelineDiagram,
		chart: renderChartDiagram,
		"state-machine": renderStateMachineDiagram,
		gantt: renderGanttDiagram,
		er: renderErDiagram,
		class: renderClassDiagram,
		"org-chart": renderOrgChartDiagram,
		venn: renderVennDiagram,
		journey: renderJourneyDiagram,
		sankey: renderSankeyDiagram,
		wireframe: renderWireframeDiagram,
		quadrant: renderQuadrantDiagram,
	});
}
