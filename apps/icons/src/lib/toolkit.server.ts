import { IconDetail, IconSearchPage } from "@sketchi/icon-catalog/http-api";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { getIconDetail, searchIconResults, IconSource, IconSourceError } from "./api.server.js";

export class IconNotFound extends Schema.TaggedError<
	IconNotFound,
	{ readonly brand: unique symbol }
>()("IconNotFound", {
	message: Schema.String,
}) {}

const SearchIcons = Tool.make("search_icons", {
	description:
		"Search Sketchi icons by slug, name, alias, keyword, or collection. Results are ranked and include stable SVG and JSON URLs, and colorMode with onDark/onLight (invert or plate) where a mark would vanish on that background.",
	parameters: Schema.Struct({
		collection: Schema.optionalKey(
			Schema.Trim.annotate({ description: "Optional collection slug to filter by." }),
		),
		limit: Schema.optionalKey(
			Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
				description: "Maximum results from 1 to 100. Defaults to 50.",
			}),
		),
		q: Schema.optionalKey(
			Schema.Trim.annotate({
				description: "Search text. Aliases such as k8s and psql are supported.",
			}),
		),
	}),
	success: IconSearchPage,
	dependencies: [IconSource],
})
	.annotate(Tool.Title, "Search Sketchi icons")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

const GetIcon = Tool.make("get_icon", {
	description:
		"Get one Sketchi icon by its public slug. The first text block is the raw SVG source.",
	parameters: Schema.Struct({
		slug: Schema.Trim.check(Schema.isMinLength(1)).annotate({
			description: "Exact public icon slug from search_icons.",
		}),
	}),
	success: IconDetail,
	failure: Schema.Union([IconNotFound, IconSourceError]),
	dependencies: [IconSource],
})
	.annotate(Tool.Title, "Get a Sketchi icon")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

export const IconToolkit = Toolkit.make(SearchIcons, GetIcon);
export const IconToolHandlers = IconToolkit.toLayer({
	search_icons: Effect.fn("icons.tools.search")(function* (input) {
		const { origin } = yield* IconSource;
		return searchIconResults({
			origin,
			...(input.limit === undefined ? {} : { limit: input.limit }),
			...(input.collection ? { collection: input.collection } : {}),
			...(input.q ? { query: input.q } : {}),
		});
	}),
	get_icon: Effect.fn("icons.tools.get")(function* ({ slug }) {
		const detail = yield* getIconDetail(slug);
		return detail ?? (yield* new IconNotFound({ message: `Icon ${slug} was not found.` }));
	}),
});
