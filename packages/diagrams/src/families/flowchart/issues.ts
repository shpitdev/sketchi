import { Schema } from "effect";
import { CodeModeIssue } from "../../build/result.js";
import { FLOWCHART_COVERAGE_CODES } from "./coverage-codes.js";

/** Coverage notes can accompany an accepted flowchart. Keep the published codes. */
export const PublishedCoverageIssue = CodeModeIssue.mapFields((fields) => ({
	...fields,
	code: Schema.Literals(FLOWCHART_COVERAGE_CODES),
}));
