import { CommunityHttpApi } from "@sketchi/community-icons/http-api";
import { Array, Effect, Option, Stream, String } from "effect";
import { HttpApiClient } from "effect/http-api";
import { AsyncResult, Atom, AtomHttpApi } from "effect/reactivity";

import { bareSlug } from "./community-client";
import { browserOrigin, IconQueryError, queryHttpLayer, refreshOnReconnect } from "./query-atoms";

export class CommunityApi extends AtomHttpApi.Service<CommunityApi>()("IconsCommunityApi", {
	api: CommunityHttpApi,
	httpClient: (get) => get(queryHttpLayer),
	transformClient: browserOrigin,
}) {}

export const communitySearch = Atom.make("").pipe(Atom.setIdleTTL(0));
const decodePage = HttpApiClient.decodeResponse(CommunityHttpApi, {
	group: "community",
	endpoint: "list",
});
const decodeDetail = HttpApiClient.decodeResponse(CommunityHttpApi, {
	group: "community",
	endpoint: "detail",
});

const communityPageStream = CommunityApi.runtime
	.pull((get) => {
		const query = String.trim(get(communitySearch));
		return Stream.paginate(
			undefined,
			Effect.fn("Icons.community.page")(function* (cursor: string | undefined) {
				const client = yield* CommunityApi;
				const response = yield* client.community.list({
					query: { ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) },
					responseMode: "response-only",
				});
				if (response.status < 200 || response.status >= 300)
					return yield* Effect.fail(
						new IconQueryError({ message: `Community icons returned HTTP ${response.status}.` }),
					);
				const page = yield* decodePage(response);
				return [[page], Option.fromNullishOr(page.nextCursor)] as const;
			}),
		);
	})
	.pipe(refreshOnReconnect, Atom.setIdleTTL(0), Atom.withServerValueInitial);

// Scroll notifications can share a React render. Read the registry's live pull
// state at the write boundary so a second notification cannot queue another page.
export const communityPages = Atom.writable(
	(get) => get(communityPageStream),
	(context, _value: void) => {
		const current = context.get(communityPageStream);
		if (current.waiting || !AsyncResult.isSuccess(current)) return;
		const last = Option.getOrUndefined(Array.last(current.value.items));
		if (last?.nextCursor !== undefined) context.set(communityPageStream, undefined);
	},
	(refresh) => refresh(communityPageStream),
).pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);

export const linkedCommunityIcon = Atom.family((slug: string | undefined) =>
	CommunityApi.runtime
		.atom(
			Effect.gen(function* () {
				if (slug === undefined) return { status: "missing" } as const;
				const client = yield* CommunityApi;
				const response = yield* client.community.detail({
					params: { slug: bareSlug(slug) },
					responseMode: "response-only",
				});
				if (response.status === 404) return { status: "missing" } as const;
				if (response.status < 200 || response.status >= 300)
					return yield* Effect.fail(
						new IconQueryError({ message: `Community icon returned HTTP ${response.status}.` }),
					);
				return { status: "found", icon: yield* decodeDetail(response) } as const;
			}),
		)
		.pipe(refreshOnReconnect, Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
