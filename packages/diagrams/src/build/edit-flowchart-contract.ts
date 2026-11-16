import { flowchartBuild, FlowchartRequestText } from "../families/flowchart/build";
import { FlowchartEditsSchema } from "../families/flowchart/edits";
import { BuildOptions } from "./result";

import { Schema } from "effect";

import {
	literals,
	NonEmptyString,
	optionalContract,
	requiredObject,
	RequiredNonEmptyString,
} from "./schema";

/**
 * A change to a built flowchart: the artifact it starts from and the edits, by id. The edited
 * document builds as a new artifact.
 */
export const EditFlowchartRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	artifactId: RequiredNonEmptyString,
	edits: requiredObject(FlowchartEditsSchema),
	request: optionalContract(FlowchartRequestText),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface EditFlowchartRequest extends Schema.Schema.Type<typeof EditFlowchartRequest> {}

/** An edited flowchart, built as a new artifact whose provenance names the one it changed. */
export const EditFlowchartAccepted = Schema.Struct({
	...flowchartBuild.accepted.fields,
	/** The edits as applied. */
	edits: FlowchartEditsSchema,
}).annotate({ identifier: undefined });

export interface EditFlowchartAccepted extends Schema.Schema.Type<typeof EditFlowchartAccepted> {}
/**
 * An edit that stored nothing: no flowchart document to start from, an edit naming what the
 * document lacks, or an edited document that does not build.
 */
export const EditFlowchartRejected = Schema.Struct({
	...flowchartBuild.rejected.fields,
	status: literals([
		...flowchartBuild.rejected.fields.status.literals,
		"not_found",
		"invalid_edit",
	]),
}).annotate({ identifier: undefined });

export interface EditFlowchartRejected extends Schema.Schema.Type<typeof EditFlowchartRejected> {}
export const EditFlowchartResultSchema = Schema.Union([
	EditFlowchartAccepted,
	EditFlowchartRejected,
]);
export type EditFlowchartResult = typeof EditFlowchartResultSchema.Type;
