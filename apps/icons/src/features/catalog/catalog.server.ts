import { searchIcons, type SketchiIcon } from "@sketchi/icon-catalog";
import { getIconBySlug, getIconSourcePath, iconManifest } from "@sketchi/icon-catalog/catalog";

import { Array, Context, Effect, Schema, String } from "effect";
import type { IconDetail, IconSearchResult } from "@sketchi/icon-catalog/http-api";

export type IconSourceLoader = (request: Request, icon: SketchiIcon) => Promise<string>;

export interface IconAssetsBinding {
	fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

export function createIconSourceLoader(assets: IconAssetsBinding): IconSourceLoader {
	// @effect-diagnostics-next-line asyncFunction:off -- Cloudflare ASSETS and the retained MCP transport require this cancellable Promise loader.
	return async (request, icon) => {
		const sourcePath = getIconSourcePath(icon.slug);
		if (!sourcePath) {
			throw new Error(`Source path not found for ${icon.slug}.`);
		}
		const response = await assets.fetch(new URL(sourcePath, request.url), {
			signal: request.signal,
		});
		if (!response.ok) {
			throw new Error(`Icon source returned HTTP ${response.status}.`);
		}
		return response.text();
	};
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export class IconSource extends Context.Service<
	IconSource,
	{
		readonly origin: string;
		readonly sourceLoader: IconSourceLoader;
	}
>()("sketchi/icons/Source") {}
export class IconSourceError extends Schema.TaggedError<
	IconSourceError,
	{ readonly brand: unique symbol }
>()("IconSourceError", { cause: Schema.Defect(), message: Schema.String }) {}

function apiUrls(origin: string, slug: string) {
	const encodedSlug = encodeURIComponent(slug);
	return {
		detailUrl: new URL(`/api/icons/${encodedSlug}`, origin).href,
		svgUrl: new URL(`/api/icons/${encodedSlug}.svg`, origin).href,
	};
}

export function iconSearchResult(icon: SketchiIcon, origin: string): IconSearchResult {
	return {
		aliases: icon.aliases,
		collection: icon.collection,
		colorMode: icon.colorMode,
		...apiUrls(origin, icon.slug),
		keywords: icon.keywords,
		name: icon.name,
		...(icon.onDark ? { onDark: icon.onDark } : {}),
		...(icon.onLight ? { onLight: icon.onLight } : {}),
		slug: icon.slug,
	};
}

export function parseIconLimit(value: string | null): number {
	if (value === null || String.trim(value) === "") {
		return DEFAULT_LIMIT;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		return DEFAULT_LIMIT;
	}
	return Math.min(parsed, MAX_LIMIT);
}

export function searchIconResults(input: {
	readonly collection?: string;
	readonly limit?: number;
	readonly origin: string;
	readonly query?: string;
}) {
	const allMatches = searchIcons(iconManifest.icons, {
		...(input.collection ? { collection: input.collection } : {}),
		...(input.query ? { query: input.query } : {}),
	});
	const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	return {
		collection: input.collection ?? null,
		count: Math.min(allMatches.length, limit),
		query: input.query ?? "",
		results: Array.map(Array.take(allMatches, limit), ({ icon }) =>
			iconSearchResult(icon, input.origin),
		),
		total: allMatches.length,
	};
}

export const getIconDetail = Effect.fn("Icons.detail")(function* (slug: string) {
	const { origin, sourceLoader } = yield* IconSource;
	const icon = getIconBySlug(slug);
	if (!icon) return undefined;
	const svg = yield* Effect.tryPromise({
		try: (signal) => sourceLoader(new Request(origin, { signal }), icon),
		catch: (cause) =>
			new IconSourceError({
				cause,
				message: cause instanceof Error ? cause.message : "Icon source failed.",
			}),
	});
	return {
		...iconSearchResult(icon, origin),
		bytes: icon.bytes,
		svg,
		...(icon.variant ? { variant: icon.variant } : {}),
		viewBox: icon.viewBox,
	} satisfies IconDetail;
});
