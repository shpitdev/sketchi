import { Schema, SchemaGetter } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

const surfaceTreatment = Schema.Literals(["invert", "plate"]);
export const IconSearchResult = Schema.Struct({
	aliases: Schema.Array(Schema.String),
	collection: Schema.String,
	colorMode: Schema.Literals(["mono-dark", "mono-light", "multicolor"]),
	detailUrl: Schema.String,
	svgUrl: Schema.String,
	keywords: Schema.Array(Schema.String),
	name: Schema.String,
	onDark: Schema.optionalKey(surfaceTreatment),
	onLight: Schema.optionalKey(surfaceTreatment),
	slug: Schema.String,
});
export const IconDetail = Schema.Struct({
	...IconSearchResult.fields,
	bytes: Schema.Number,
	svg: Schema.String,
	variant: Schema.optionalKey(Schema.String),
	viewBox: Schema.Struct({
		minX: Schema.Number,
		minY: Schema.Number,
		width: Schema.Number,
		height: Schema.Number,
	}),
});

export interface IconSearchResult extends Schema.Schema.Type<typeof IconSearchResult> {}
export interface IconDetail extends Schema.Schema.Type<typeof IconDetail> {}
export const IconSearchPage = Schema.Struct({
	collection: Schema.NullOr(Schema.String),
	count: Schema.Number,
	query: Schema.String,
	results: Schema.Array(IconSearchResult),
	total: Schema.Number,
});
// URLSearchParams.get used the first value when a caller repeated a query key.
const QueryValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((value) =>
			typeof value === "string" ? value : (value[0] ?? ""),
		),
		encode: SchemaGetter.transform((value) => value),
	}),
);
const sourceFailure = Schema.Struct({
	status: Schema.Literal(500),
	statusText: Schema.Literal(""),
	unhandled: Schema.Literal(true),
	message: Schema.Literal("HTTPError"),
}).pipe(HttpApiSchema.status(500));
export const IconCatalogHttpGroup = HttpApiGroup.make("catalog").add(
	HttpApiEndpoint.get("search", "/api/icons", {
		query: {
			q: Schema.optionalKey(QueryValue),
			collection: Schema.optionalKey(QueryValue),
			limit: Schema.optionalKey(QueryValue),
		},
		success: IconSearchPage,
	}),
	HttpApiEndpoint.get("raw", "/api/icons/:slug.svg", {
		params: { slug: Schema.String },
		success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "image/svg+xml" })),
		error: [Schema.String.pipe(HttpApiSchema.asText(), HttpApiSchema.status(404)), sourceFailure],
	}),
	HttpApiEndpoint.head("rawHead", "/api/icons/:slug.svg", {
		params: { slug: Schema.String },
		error: [HttpApiSchema.Empty(404), sourceFailure],
	}),
	HttpApiEndpoint.head("detailHead", "/api/icons/:slug", {
		params: { slug: Schema.String },
		error: HttpApiSchema.Empty(405),
	}),
	HttpApiEndpoint.get("detail", "/api/icons/:slug", {
		params: { slug: Schema.String },
		success: IconDetail,
		error: [
			Schema.Struct({ error: Schema.String, slug: Schema.String }).pipe(HttpApiSchema.status(404)),
			sourceFailure,
		],
	}),
);
export const IconCatalogHttpApi = HttpApi.make("IconCatalogHttpApi").add(IconCatalogHttpGroup);
