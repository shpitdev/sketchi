import { Schema } from "effect";
import { BuildIssue } from "../../build/result";
import { FLOWCHART_COVERAGE_CODES } from "./coverage-codes";

/** Coverage notes can accompany an accepted flowchart. Keep the published codes. */
export const PublishedCoverageIssue = BuildIssue.mapFields((fields) => ({
	...fields,
	code: Schema.Literals(FLOWCHART_COVERAGE_CODES),
}));
