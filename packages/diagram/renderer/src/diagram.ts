import { renderChartDiagram } from "./chart.js";
import { renderTimelineDiagram } from "./timeline.js";
import type { CanonicalDiagram } from "@sketchi/diagram-core";

import { type RenderedDiagramScene, renderIntermediateDiagram } from "./scene.js";
import { renderSequenceDiagram } from "./sequence.js";

/** Render any canonical diagram with its family's renderer. */
export function renderDiagram(diagram: CanonicalDiagram): RenderedDiagramScene {
	switch (diagram.type) {
		case "flowchart":
		case "mindmap":
			return renderIntermediateDiagram(diagram);
		case "timeline":
			return renderTimelineDiagram(diagram);
		case "sequence":
			return renderSequenceDiagram(diagram);
		case "chart":
			return renderChartDiagram(diagram);
	}
}
