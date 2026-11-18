import { Array as Arr, Record as Rec, Schema, SchemaGetter } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { IconDrawRequestSchema, IconDrawSuccess } from "./contract";

export { ICON_IMAGE_MAX_BYTES, ICON_NAME_MAX_LENGTH, type IconDrawSuccess } from "./contract";

export const ICON_DRAW_PATH = "/api/v1/icons/draw";

const refusalStatuses = {
	invalid_input: 400,
	unsupported_model: 400,
	invalid_recipe: 422,
	rate_limited: 429,
	provider_failed: 502,
	render_failed: 502,
	not_configured: 503,
	unavailable: 503,
	draw_timeout: 504,
} as const;

const IconDrawIssue = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	hint: Schema.String,
});
export interface IconDrawIssue extends Schema.Schema.Type<typeof IconDrawIssue> {}

const IconDrawFailure = Schema.Struct({
	ok: Schema.Literal(false),
	status: Schema.Literals(Rec.keys(refusalStatuses)),
	issues: Schema.NonEmptyArray(IconDrawIssue),
});
export interface IconDrawFailure extends Schema.Schema.Type<typeof IconDrawFailure> {}

/** In memory the refusal carries the HTTP status; on the wire only its body is JSON. */
export function iconDrawHttpFailure(body: IconDrawFailure) {
	return { httpStatus: refusalStatuses[body.status], body };
}

export const IconDrawHttpApi = HttpApi.make("IconDrawHttpApi").add(
	HttpApiGroup.make("icons").add(
		HttpApiEndpoint.post("draw", ICON_DRAW_PATH, {
			payload: IconDrawRequestSchema,
			success: IconDrawSuccess,
			error: Arr.dedupe(Rec.values(refusalStatuses)).map((httpStatus) =>
				IconDrawFailure.check(
					Schema.makeFilter(({ status }) => refusalStatuses[status] === httpStatus),
				).pipe(
					Schema.decodeTo(
						Schema.Struct({ httpStatus: Schema.Literal(httpStatus), body: IconDrawFailure }),
						{
							decode: SchemaGetter.transform((body: IconDrawFailure) => ({ httpStatus, body })),
							encode: SchemaGetter.transform((failure) => failure.body),
						},
					),
					HttpApiSchema.status(httpStatus),
				),
			),
		}),
	),
);
