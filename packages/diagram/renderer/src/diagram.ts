import { Result, Schema } from "effect";
import {
	type CanonicalValidationError,
	type CanonicalDiagram,
	CanonicalDiagramSchema,
} from "@sketchi/diagram-core";

import { renderChartDiagram } from "./chart.js";
import { renderGanttDiagram } from "./gantt.js";
import { renderTimelineDiagram } from "./timeline.js";

import { renderMindmap } from "@sketchi/diagrams/mindmap";
import { renderIntermediateDiagram } from "./scene.js";
import { type CanvasSpec as RenderedDiagramScene } from "@sketchi/drawing";
import { renderSequenceDiagram } from "./sequence.js";
import { renderStateMachineDiagram } from "./state-machine.js";
import { renderErDiagram } from "./er.js";
import { renderClassDiagram } from "./class-diagram.js";
import { renderOrgChartDiagram } from "./org-chart.js";
import { renderVennDiagram } from "./venn.js";
import { renderJourneyDiagram } from "./journey.js";
import { renderSankeyDiagram } from "./sankey.js";
import { renderWireframeDiagram } from "./wireframe.js";
import { renderQuadrantDiagram } from "./quadrant.js";

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
