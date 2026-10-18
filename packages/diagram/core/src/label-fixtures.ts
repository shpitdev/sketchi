import { parseFlowchartDiagram } from "./types/flowchart.js";
import competingBranchLabels from "./fixtures/labels/competing-branch-labels.js";
import identifierLabels from "./fixtures/labels/identifier-labels.js";
import longBranchLabels from "./fixtures/labels/long-branch-labels.js";
import multilineLabels from "./fixtures/labels/multiline-labels.js";
import unresolvedLabels from "./fixtures/labels/unresolved-labels.js";

function flowchart(fixture: object) {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	});
}

/**
 * Label regressions: long words, identifiers, multi-line and Unicode labels,
 * loop-backs and crowded branches. Their words must stay whole and their edge
 * labels clear of every line, node and label in every direction.
 */
export const labelFixtures = {
	"long-branch-labels": flowchart(longBranchLabels),
	"unresolved-labels": flowchart(unresolvedLabels),
	"identifier-labels": flowchart(identifierLabels),
	"multiline-labels": flowchart(multilineLabels),
	"competing-branch-labels": flowchart(competingBranchLabels),
};
