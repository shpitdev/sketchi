import { IconRecipeSchema } from "@sketchi/drawing";
import { Schema, SchemaGetter } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { CommunityIconVerdict, PublishCommunityIconRequest } from "./contracts";

/** The public wire representation, shared by HTTP serving and generated clients. */
export const CommunityIconResult = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	recipe: IconRecipeSchema,
	colors: Schema.Array(Schema.String),
	createdAt: Schema.String,
	url: Schema.String,
	api: Schema.String,
});
export interface CommunityIconResult extends Schema.Schema.Type<typeof CommunityIconResult> {}
export const CommunityPublished = Schema.Struct({
	...CommunityIconResult.fields,
	created: Schema.Boolean,
});
export const CommunityDetail = Schema.Struct({
	...CommunityIconResult.fields,
	verdict: Schema.optionalKey(CommunityIconVerdict),
});
export const CommunityPage = Schema.Struct({
	query: Schema.String,
	count: Schema.Number,
	results: Schema.Array(CommunityIconResult),
	nextCursor: Schema.optionalKey(Schema.String),
});
export const CommunityHttpError = Schema.Struct({
	error: Schema.Struct({
		code: Schema.Literals([
			"invalid_request",
			"invalid_recipe",
			"recipe_clips",
			"rejected",
			"unavailable",
			"rate_limited",
			"not_found",
			"unauthorized",
		]),
		message: Schema.String,
		issues: Schema.optionalKey(Schema.Array(Schema.String)),
		slug: Schema.optionalKey(Schema.String),
	}),
});
export const CommunityVisibilityRequest = Schema.Struct({ hidden: Schema.Boolean });
const unavailable = CommunityHttpError.pipe(HttpApiSchema.status(503));
const notFound = CommunityHttpError.pipe(HttpApiSchema.status(404));
const invalid = CommunityHttpError.pipe(HttpApiSchema.status(400));
const tooLarge = CommunityHttpError.pipe(HttpApiSchema.status(413));

// URLSearchParams.get used the first value when a caller repeated a query key.
const QueryValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((value) =>
			typeof value === "string" ? value : (value[0] ?? ""),
		),
		encode: SchemaGetter.transform((value) => value),
	}),
);
export const CommunityHttpGroup = HttpApiGroup.make("community").add(
	HttpApiEndpoint.get("list", "/api/community", {
		query: {
			q: Schema.optionalKey(QueryValue),
			limit: Schema.optionalKey(QueryValue),
			cursor: Schema.optionalKey(QueryValue),
		},
		success: CommunityPage,
		error: unavailable,
	}),
	HttpApiEndpoint.get("detail", "/api/community/:slug", {
		params: { slug: Schema.String },
		success: CommunityDetail,
		error: [notFound, unavailable],
	}),
	HttpApiEndpoint.post("publish", "/api/community", {
		payload: PublishCommunityIconRequest,
		success: [CommunityPublished, CommunityPublished.pipe(HttpApiSchema.status(201))],
		error: [
			invalid,
			tooLarge,
			CommunityHttpError.pipe(HttpApiSchema.status(422)),
			CommunityHttpError.pipe(HttpApiSchema.status(429)),
			unavailable,
		],
	}),
	HttpApiEndpoint.patch("visibility", "/api/community/:slug", {
		params: { slug: Schema.String },
		payload: CommunityVisibilityRequest,
		success: Schema.Struct({ slug: Schema.String, hidden: Schema.Boolean }),
		error: [
			invalid,
			tooLarge,
			notFound,
			CommunityHttpError.pipe(HttpApiSchema.status(401)),
			unavailable,
		],
	}),
);
export const CommunityHttpApi = HttpApi.make("CommunityHttpApi").add(CommunityHttpGroup);
