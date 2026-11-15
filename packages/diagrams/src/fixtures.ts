import { chartFixture } from "./families/chart/document.js";
import { timelineFixture } from "./families/timeline/document.js";
import { flowchartFixture } from "./families/flowchart/diagram.js";
import { mindmapFixture } from "./families/mindmap/fixtures.js";
import { sequenceFixture } from "./families/sequence/document.js";
import { stateMachineFixture } from "./families/state-machine/document.js";
import { ganttFixture } from "./families/gantt/document.js";
import { erFixture } from "./families/er/document.js";
import { classFixture } from "./families/class/document.js";
import { orgChartFixture } from "./families/org-chart/document.js";
import { vennFixture } from "./families/venn/document.js";
import { journeyFixture } from "./families/journey/document.js";
import { sankeyFixture } from "./families/sankey/document.js";
import { wireframeFixture } from "./families/wireframe/document.js";
import { quadrantFixture } from "./families/quadrant/document.js";
import { type CanonicalDiagram } from "./diagram.js";

/** One maintained fixture per canonical family. */
export const diagramFixtures: readonly CanonicalDiagram[] = [
	flowchartFixture,
	mindmapFixture,
	sequenceFixture,
	timelineFixture,
	chartFixture,
	stateMachineFixture,
	ganttFixture,
	erFixture,
	classFixture,
	orgChartFixture,
	vennFixture,
	journeyFixture,
	sankeyFixture,
	wireframeFixture,
	quadrantFixture,
];
