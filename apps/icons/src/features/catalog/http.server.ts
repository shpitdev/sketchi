import { IconCatalogHttpApi, IconDetail, IconSearchPage } from "@sketchi/icon-catalog/http-api";
import { Effect, String } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import {
	getIconDetail,
	IconSource,
	parseIconLimit,
	searchIconResults,
	type IconSourceError,
} from "./catalog.server";

const sourceFailure = (error: IconSourceError) =>
	Effect.logError("Icon source failed", { cause: error.cause }).pipe(
		Effect.as(
			HttpServerResponse.jsonUnsafe(
				{ status: 500, statusText: "", unhandled: true, message: "HTTPError" },
				{ status: 500 },
			),
		),
	);
const detail = Effect.fn("Icons.http.detail")(
	function* (slug: string) {
		const icon = yield* getIconDetail(slug);
		return icon
			? yield* HttpServerResponse.schemaJson(IconDetail)(icon, {
					headers: { "Cache-Control": "public, max-age=86400" },
				}).pipe(Effect.orDie)
			: HttpServerResponse.jsonUnsafe({ error: "Icon not found.", slug }, { status: 404 });
	},
	Effect.catchTag("IconSourceError", sourceFailure),
);
const raw = Effect.fn("Icons.http.raw")(
	function* (slug: string, head = false) {
		const icon = yield* getIconDetail(slug);
		if (!icon)
			return HttpServerResponse.text("Icon not found.", {
				status: 404,
				contentType: "text/plain; charset=utf-8",
			});
		return HttpServerResponse.text(head ? "" : icon.svg, {
			headers: {
				"Cache-Control": "public, max-age=86400",
				"Content-Disposition": `inline; filename="${icon.slug}.svg"`,
				"Content-Type": "image/svg+xml; charset=utf-8",
			},
		});
	},
	Effect.catchTag("IconSourceError", sourceFailure),
);
export const IconCatalogHttpHandlers = HttpApiBuilder.group(
	IconCatalogHttpApi,
	"catalog",
	(handlers) =>
		handlers
			.handle("search", ({ query }) =>
				Effect.gen(function* () {
					const { origin } = yield* IconSource;
					const q = String.trim(query.q ?? ""),
						collection = String.trim(query.collection ?? "");
					return yield* HttpServerResponse.schemaJson(IconSearchPage)(
						searchIconResults({
							origin,
							query: q,
							...(collection ? { collection } : {}),
							limit: parseIconLimit(query.limit ?? null),
						}),
						{ headers: { "Cache-Control": "public, max-age=60" } },
					).pipe(Effect.orDie);
				}),
			)
			.handle("detail", ({ params }) => detail(params.slug))
			.handle("raw", ({ params }) => raw(params.slug))
			.handle("rawHead", ({ params }) => raw(params.slug, true))
			.handle("detailHead", () =>
				Effect.succeed(
					HttpServerResponse.empty({ status: 405, headers: { Allow: "GET, OPTIONS" } }),
				),
			),
);
