import { chartFixture } from "./types/chart.js";
import { timelineFixture } from "./types/timeline.js";
import { flowchartFixture } from "./types/flowchart.js";
import { mindmapFixture } from "./types/mindmap.js";
import { sequenceFixture } from "./types/sequence.js";
import { stateMachineFixture } from "./types/state-machine.js";
import type { CanonicalDiagram } from "./diagram.js";

/** One maintained fixture per canonical family. */
export const diagramFixtures: readonly CanonicalDiagram[] = [
	flowchartFixture,
	mindmapFixture,
	sequenceFixture,
	timelineFixture,
	chartFixture,
	stateMachineFixture,
];
