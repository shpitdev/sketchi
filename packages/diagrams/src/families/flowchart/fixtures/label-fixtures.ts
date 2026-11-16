// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Result } from "effect";
import { parseFlowchartDiagram } from "../document";
import competingBranchLabels from "./labels/competing-branch-labels";
import identifierLabels from "./labels/identifier-labels";
import longBranchLabels from "./labels/long-branch-labels";
import multilineLabels from "./labels/multiline-labels";
import unresolvedLabels from "./labels/unresolved-labels";

function flowchart(fixture: object) {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow);
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
