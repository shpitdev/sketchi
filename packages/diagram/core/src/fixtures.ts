import { flowchartFixture } from "./types/flowchart.js";
import { mindmapFixture } from "./types/mindmap.js";
import { sequenceFixture } from "./types/sequence.js";
import type { CanonicalDiagram } from "./diagram.js";

/** One maintained fixture per canonical family. */
export const diagramFixtures: readonly CanonicalDiagram[] = [
	flowchartFixture,
	mindmapFixture,
	sequenceFixture,
];
