import { CommunityHttpApi, type CommunityIconResult } from "@sketchi/community-icons/http-api";
import { Effect, String } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

/** React Query owns gallery state; this module only executes the shared HTTP contract. */
export type CommunityIconEntry = Pick<
	CommunityIconResult,
	"slug" | "name" | "recipe" | "createdAt" | "url"
>;
export interface CommunityPage {
	readonly icons: readonly CommunityIconEntry[];
	readonly nextCursor?: string;
}
const decodePage = HttpApiClient.decodeResponse(CommunityHttpApi, {
	group: "community",
	endpoint: "list",
});
const decodeDetail = HttpApiClient.decodeResponse(CommunityHttpApi, {
	group: "community",
	endpoint: "detail",
});
const page = Effect.fn("Icons.community.page")(function* (input: {
	readonly query: string;
	readonly cursor?: string;
}) {
	const client = yield* HttpApiClient.make(CommunityHttpApi, { baseUrl: window.location.origin });
	const response = yield* client.community.list({
		query: {
			...(String.trim(input.query) ? { q: String.trim(input.query) } : {}),
			...(input.cursor ? { cursor: input.cursor } : {}),
		},
		responseMode: "response-only",
	});
	if (response.status < 200 || response.status >= 300)
		return yield* Effect.fail(new Error(`Community icons returned HTTP ${response.status}.`));
	const result = yield* decodePage(response);
	return {
		icons: result.results,
		...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
	} satisfies CommunityPage;
});
export function fetchCommunityPage(input: {
	readonly query: string;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}): Promise<CommunityPage> {
	return Effect.runPromise(page(input).pipe(Effect.provide(FetchHttpClient.layer)), {
		signal: input.signal,
	});
}
export function bareSlug(slug: string): string {
	return String.replace(/^community\//u, "")(slug);
}
export type LinkedCommunityIcon =
	| { readonly status: "found"; readonly icon: CommunityIconEntry }
	| { readonly status: "missing" };
const detail = Effect.fn("Icons.community.detail")(function* (slug: string) {
	const client = yield* HttpApiClient.make(CommunityHttpApi, { baseUrl: window.location.origin });
	const response = yield* client.community.detail({
		params: { slug: bareSlug(slug) },
		responseMode: "response-only",
	});
	if (response.status === 404) return { status: "missing" } as const;
	if (response.status < 200 || response.status >= 300)
		return yield* Effect.fail(new Error(`Community icon returned HTTP ${response.status}.`));
	return { status: "found", icon: yield* decodeDetail(response) } as const;
});
export function fetchCommunityIcon(
	slug: string,
	signal?: AbortSignal,
): Promise<LinkedCommunityIcon> {
	return Effect.runPromise(detail(slug).pipe(Effect.provide(FetchHttpClient.layer)), { signal });
}
