import { renderChartDiagram } from "./chart.js";
import { renderGanttDiagram } from "./gantt.js";
import { renderTimelineDiagram } from "./timeline.js";
import type { CanonicalDiagram } from "@sketchi/diagram-core";

import { renderMindmapDiagram } from "./mindmap.js";
import { type RenderedDiagramScene, renderIntermediateDiagram } from "./scene.js";
import { renderSequenceDiagram } from "./sequence.js";
import { renderStateMachineDiagram } from "./state-machine.js";
import { renderErDiagram } from "./er.js";
import { renderClassDiagram } from "./class-diagram.js";
import { renderOrgChartDiagram } from "./org-chart.js";
import { renderVennDiagram } from "./venn.js";

/** Render any canonical diagram with its family's renderer. */
export function renderDiagram(diagram: CanonicalDiagram): RenderedDiagramScene {
	switch (diagram.type) {
		case "flowchart":
			return renderIntermediateDiagram(diagram);
		case "mindmap":
			return renderMindmapDiagram(diagram);
		case "timeline":
			return renderTimelineDiagram(diagram);
		case "sequence":
			return renderSequenceDiagram(diagram);
		case "chart":
			return renderChartDiagram(diagram);
		case "state-machine":
			return renderStateMachineDiagram(diagram);
		case "gantt":
			return renderGanttDiagram(diagram);
		case "er":
			return renderErDiagram(diagram);
		case "class":
			return renderClassDiagram(diagram);
		case "org-chart":
			return renderOrgChartDiagram(diagram);
		case "venn":
			return renderVennDiagram(diagram);
	}
}
