import { Array, Schema, SchemaGetter } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
} from "effect/http-api";
import type { PublicationRequest } from "./publication.server";
import { PublishPayload, PublishResult } from "./publication";
const FailureBody = Schema.Struct({
	error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});
const failureSchema = <const Status extends number>(status: Status) =>
	HttpApiSchema.WithHeaders(
		FailureBody.pipe(
			Schema.decodeTo(Schema.Struct({ ...FailureBody.fields, status: Schema.Literal(status) }), {
				decode: SchemaGetter.transform((body) => ({ ...body, status })),
				encode: SchemaGetter.transform(({ status: _status, ...body }) => body),
			}),
		),
		Schema.Struct({ "retry-after": Schema.optionalKey(Schema.String) }),
	).pipe(HttpApiSchema.status(status));
const failures = Array.map([400, 404, 409, 413, 429, 500, 502] as const, (status) =>
	failureSchema(status),
);
export const PublishFailure = Schema.Union(failures);
export type PublishFailure = typeof PublishFailure.Type;
export function publicationFailure(
	status: PublishFailure["body"]["status"],
	code: string,
	message: string,
	retryAfter?: number,
): PublishFailure {
	return HttpApiSchema.withHeaders({
		body: { status, error: { code, message } },
		headers: { ...(retryAfter !== undefined ? { "retry-after": `${retryAfter}` } : {}) },
	});
}
export class PublicationAdmission extends HttpApiMiddleware.Service<
	PublicationAdmission,
	{ requires: PublicationRequest }
>()("IconsPublicationAdmission", { error: failures }) {}
export class PublicationSchemaErrors extends HttpApiMiddleware.Service<PublicationSchemaErrors>()(
	"IconsPublicationSchemaErrors",
	{ error: failures },
) {}
export const PackPublicationApi = HttpApi.make("PackPublicationApi").add(
	HttpApiGroup.make("packs")
		.add(
			HttpApiEndpoint.post("publish", "/api/packs/:id/excalidraw", {
				params: { id: Schema.String },
				payload: PublishPayload,
				success: PublishResult.pipe(HttpApiSchema.status(201)),
				error: failures,
			}),
		)
		.middleware(PublicationSchemaErrors)
		.middleware(PublicationAdmission),
);
