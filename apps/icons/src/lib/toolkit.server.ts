import { Array, Context, Effect, Schema, String } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { getIconDetail, searchIconResults } from "./api.server.js";
import type { IconSourceLoader } from "./catalog.server.js";

export class IconToolSource extends Context.Service<
	IconToolSource,
	{
		readonly origin: string;
		readonly sourceLoader: IconSourceLoader;
	}
>()("sketchi/icons/ToolSource") {}

export class IconNotFound extends Schema.TaggedError<
	IconNotFound,
	{ readonly brand: unique symbol }
>()("IconNotFound", {
	message: Schema.String,
}) {}

export class IconSourceError extends Schema.TaggedError<
	IconSourceError,
	{ readonly brand: unique symbol }
>()("IconSourceError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}

const surfaceTreatment = Schema.Literals(["invert", "plate"]);
const IconSearchResult = Schema.Struct({
	aliases: Schema.Array(Schema.String),
	collection: Schema.String,
	colorMode: Schema.Literals(["mono-dark", "mono-light", "multicolor"]),
	detailUrl: Schema.String,
	keywords: Schema.Array(Schema.String),
	name: Schema.String,
	onDark: Schema.optionalKey(surfaceTreatment),
	onLight: Schema.optionalKey(surfaceTreatment),
	slug: Schema.String,
	svgUrl: Schema.String,
});
const IconDetail = Schema.Struct({
	...IconSearchResult.fields,
	bytes: Schema.Number,
	svg: Schema.String,
	variant: Schema.optionalKey(Schema.String),
	viewBox: Schema.Struct({
		height: Schema.Number,
		minX: Schema.Number,
		minY: Schema.Number,
		width: Schema.Number,
	}),
});

const SearchIcons = Tool.make("search_icons", {
	description:
		"Search Sketchi icons by slug, name, alias, keyword, or collection. Results are ranked and include stable SVG and JSON URLs, and colorMode with onDark/onLight (invert or plate) where a mark would vanish on that background.",
	parameters: Schema.Struct({
		collection: Schema.optionalKey(
			Schema.String.annotate({ description: "Optional collection slug to filter by." }),
		),
		limit: Schema.optionalKey(
			Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
				description: "Maximum results from 1 to 100. Defaults to 50.",
			}),
		),
		q: Schema.optionalKey(
			Schema.String.annotate({
				description: "Search text. Aliases such as k8s and psql are supported.",
			}),
		),
	}),
	success: Schema.Struct({
		collection: Schema.NullOr(Schema.String),
		count: Schema.Number,
		query: Schema.String,
		results: Schema.Array(IconSearchResult),
		total: Schema.Number,
	}),
	dependencies: [IconToolSource],
})
	.annotate(Tool.Title, "Search Sketchi icons")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

const GetIcon = Tool.make("get_icon", {
	description:
		"Get one Sketchi icon by its public slug. The first text block is the raw SVG source.",
	parameters: Schema.Struct({
		slug: Schema.String.check(Schema.isMinLength(1)).annotate({
			description: "Exact public icon slug from search_icons.",
		}),
	}),
	success: IconDetail,
	failure: Schema.Union([IconNotFound, IconSourceError]),
	dependencies: [IconToolSource],
})
	.annotate(Tool.Title, "Get a Sketchi icon")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

export const IconToolkit = Toolkit.make(SearchIcons, GetIcon);
export const IconToolHandlers = IconToolkit.toLayer({
	search_icons: Effect.fn("icons.tools.search")(function* (input) {
		const { origin } = yield* IconToolSource;
		return searchIconResults({ origin, ...input, ...(input.q ? { query: input.q } : {}) });
	}),
	get_icon: Effect.fn("icons.tools.get")(function* ({ slug }) {
		const { origin, sourceLoader } = yield* IconToolSource;
		const detail = yield* Effect.tryPromise({
			try: (signal) => getIconDetail(new Request(origin, { signal }), slug, sourceLoader),
			catch: (cause) =>
				new IconSourceError({
					cause,
					message: cause instanceof Error ? cause.message : "Icon source failed.",
				}),
		});
		return detail ?? (yield* new IconNotFound({ message: `Icon ${slug} was not found.` }));
	}),
});

/** Preserve the existing SDK ingress normalization; Toolkit owns schema validation. */
export function normalizeIconToolArguments(name: string, input: Schema.Json): Schema.Json {
	const record =
		input !== null && typeof input === "object" && !Array.isArray<Schema.Json>(input) ? input : {};
	const optionalString = (key: string) => {
		const value = record[key];
		return typeof value === "string" && String.isNonEmpty(String.trim(value))
			? String.trim(value)
			: undefined;
	};
	if (name === "get_icon") return { slug: optionalString("slug") ?? "" };
	const q = optionalString("q");
	const collection = optionalString("collection");
	return {
		...(q ? { q } : {}),
		...(collection ? { collection } : {}),
		...(record.limit !== undefined ? { limit: record.limit } : {}),
	};
}
