import { Array as Arr, Schema, SchemaGetter } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { CANVAS_LIMITS } from "@sketchi/drawing";

import {
	EditFlowchartAccepted,
	EditFlowchartRejected,
	EditFlowchartRequest,
} from "./build/code-mode/edit-flowchart-contract.js";
import { GetArtifactAccepted, GetArtifactRejected } from "./canvas/artifact-contract.js";
import {
	CreateCanvasAccepted,
	CreateCanvasRejected,
	CreateCanvasRequest,
} from "./canvas/create-contract.js";
import {
	ApplyDiagramPatchAccepted,
	ApplyDiagramPatchRejected,
	ApplyDiagramPatchRequest,
} from "./canvas/patch-contract.js";
import { families, type DiagramFamily } from "./family.js";
import { GenerateAccepted, GenerateRejected, GenerateRequest } from "./generate/contract.js";

/** The HTTP status of each refusal a build, canvas or generate response can carry. */
export const FAILURE_HTTP_STATUS = {
	invalid_input: 400,
	unsupported_model: 400,
	invalid_flowchart: 422,
	invalid_edit: 422,
	invalid_mindmap: 422,
	invalid_sequence: 422,
	invalid_timeline: 422,
	invalid_chart: 422,
	invalid_state_machine: 422,
	invalid_gantt: 422,
	invalid_er_diagram: 422,
	invalid_class_diagram: 422,
	invalid_org_chart: 422,
	invalid_venn_diagram: 422,
	invalid_journey: 422,
	invalid_sankey: 422,
	invalid_wireframe: 422,
	invalid_quadrant_chart: 422,
	invalid_canvas: 422,
	invalid_generated_document: 422,
	quality_failed: 422,
	unsupported_operation: 422,
	connectivity_changed: 422,
	unsupported_diagram_type: 422,
	malformed_output: 422,
	limit_exceeded: 413,
	not_found: 404,
	format_unavailable: 404,
	source_unavailable: 404,
	target_not_found: 404,
	expired: 410,
	render_failed: 500,
	export_failed: 500,
	storage_failed: 500,
	// Generation's upstream failures keep their gateway semantics.
	provider_failed: 502,
	generation_timeout: 504,
} as const;
export type FailureStatus = keyof typeof FAILURE_HTTP_STATUS;

/** A family build body larger than this is refused with HTTP 413 before it is read further. */
export const MAX_BUILD_REQUEST_BYTES = 256 * 1024;
/** A canvas or patch carries a scene up to the canvas limit, with room for the request around it. */
export const MAX_CANVAS_REQUEST_BYTES = CANVAS_LIMITS.maxSerializedBytes + 64 * 1024;

/**
 * A refusal as it is failed and decoded in memory: the response body and the HTTP status it is
 * sent with. Only the body travels; the status is the response's.
 */
export interface HttpFailure<A> {
	readonly httpStatus: number;
	readonly body: A;
}

type Rejection = Schema.Codec<unknown, unknown> & {
	readonly fields: { readonly status: { readonly literals: ReadonlyArray<FailureStatus> } };
};

function failureAt<A, I>(rejected: Schema.Codec<A, I>, httpStatus: number) {
	return rejected.pipe(
		Schema.decodeTo(
			Schema.Struct({ httpStatus: Schema.Literal(httpStatus), body: Schema.toType(rejected) }),
			{
				decode: SchemaGetter.transform((body: A) => ({ httpStatus, body })),
				encode: SchemaGetter.transform((value: HttpFailure<A>) => value.body),
			},
		),
		HttpApiSchema.status(httpStatus),
	);
}

/**
 * One error declaration per HTTP status a refusal can be sent with, derived from the owning
 * rejection schema. `also` adds statuses the host uses for refusals outside the table, such as an
 * oversized body (HTTP 413 with an invalid_input body).
 */
function failures<S extends Rejection>(rejected: S, also: ReadonlyArray<number> = []) {
	const statuses = Arr.dedupe([
		...Arr.map(rejected.fields.status.literals, (status) => FAILURE_HTTP_STATUS[status]),
		...also,
	]);
	return Arr.map(statuses, (httpStatus) =>
		failureAt<S["Type"], S["Encoded"]>(rejected, httpStatus),
	);
}

/** A refusal with the status it is sent with: the table's, unless the host sends it otherwise. */
export function httpFailure<A extends { readonly status: FailureStatus }>(
	body: A,
	httpStatus: number = FAILURE_HTTP_STATUS[body.status],
): HttpFailure<A> {
	return { httpStatus, body };
}

/** Each family's build, at the path the family owns. */
const familyGroup = (family: DiagramFamily) =>
	HttpApiGroup.make(family.type).add(
		HttpApiEndpoint.post("build", family.path, {
			payload: family.request,
			success: family.contracts.accepted,
			error: failures(family.contracts.rejected, [413]),
		}),
	);

export const DiagramsHttpApi = HttpApi.make("SketchiDiagramsApi")
	.add(...Arr.map(families, familyGroup))
	.add(
		HttpApiGroup.make("edit").add(
			HttpApiEndpoint.post("flowchart", "/api/v1/flowcharts/edit", {
				payload: EditFlowchartRequest,
				success: EditFlowchartAccepted,
				error: failures(EditFlowchartRejected, [413]),
			}),
		),
	)
	.add(
		HttpApiGroup.make("canvas").add(
			HttpApiEndpoint.post("createCanvas", "/api/v1/canvases/create", {
				payload: CreateCanvasRequest,
				success: CreateCanvasAccepted,
				error: failures(CreateCanvasRejected),
			}),
			// `raw=true` answers with the stored file itself (Excalidraw, scene JSON or PNG), named
			// for download; every other request answers with the retrieval result.
			HttpApiEndpoint.get("getArtifact", "/api/v1/artifacts/:artifactId", {
				params: { artifactId: Schema.String },
				query: {
					format: Schema.optionalKey(Schema.String),
					inline: Schema.optionalKey(Schema.String),
					raw: Schema.optionalKey(Schema.String),
				},
				success: GetArtifactAccepted,
				error: failures(GetArtifactRejected),
			}),
			HttpApiEndpoint.post("patchArtifact", "/api/v1/artifacts/:artifactId/patch", {
				params: { artifactId: Schema.String },
				payload: ApplyDiagramPatchRequest.mapFields((fields) => ({
					...fields,
					// The route's artifact is the source when the body names none.
					source: Schema.optionalKey(fields.source),
				})),
				success: ApplyDiagramPatchAccepted,
				error: failures(ApplyDiagramPatchRejected),
			}),
		),
	)
	.add(
		HttpApiGroup.make("generate").add(
			HttpApiEndpoint.post("generate", "/api/v1/generate", {
				payload: GenerateRequest,
				success: GenerateAccepted,
				error: failures(GenerateRejected),
			}),
		),
	);
