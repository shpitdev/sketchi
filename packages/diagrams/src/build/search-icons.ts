import { COMMUNITY_ICON_COLLECTION, COMMUNITY_ICON_SLUG_PREFIX } from "@sketchi/drawing";
import { cleanToolString } from "../clean-text";

import { Effect, Result, Schema } from "effect";

import { boundary, type CodeModeWorkflowEffect } from "./boundary";
import { type BuildCommunityIcon, type BuildIconCatalog } from "./icons";
import {
	codeModeInputIssues,
	failureResult,
	FailureContextSchema,
	issue,
	workflowFailure,
} from "./issues";
import { BuildRuntimeEnvironment } from "./runtime";
import {
	DEFAULT_ICON_SEARCH_LIMIT,
	SearchIconsRejected,
	SearchIconsRequest,
	type SearchIconsResult,
} from "./search-icons-contract";

const SearchIconsFailure = workflowFailure(
	"SearchIconsFailure",
	SearchIconsRejected.fields.status,
	SearchIconsRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

/** A query for community icons, without the `community/` prefix of their slugs. */
function communityIconQuery(query: string): string {
	return query.toLowerCase().startsWith(COMMUNITY_ICON_SLUG_PREFIX)
		? query.slice(COMMUNITY_ICON_SLUG_PREFIX.length)
		: query;
}

/** How a community icon answers a query: exact when its name or slug is the query, else weak. */
function communityIconMatch(query: string, icon: BuildCommunityIcon): "exact" | "weak" {
	const words = (text: string) =>
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim();
	const bare = words(communityIconQuery(query));
	return words(icon.name) === bare || words(icon.slug) === words(`community ${bare}`)
		? "exact"
		: "weak";
}

/**
 * Curated marks first within each match, community icons after them: exact
 * curated, exact community, the curated vendor and weak marks, then weak
 * community icons.
 */
function rankIconSearch(
	query: string,
	curated: ReturnType<BuildIconCatalog["search"]>,
	community: readonly BuildCommunityIcon[],
	limit: number,
) {
	const marks = curated.map(({ collection, match, name, slug }) => ({
		slug,
		name,
		collection,
		match,
	}));
	const drawings = community
		.filter((icon) => !marks.some((mark) => mark.slug === icon.slug))
		.map((icon) => ({
			slug: icon.slug,
			name: icon.name,
			collection: COMMUNITY_ICON_COLLECTION,
			match: communityIconMatch(query, icon),
		}));
	return [
		...marks.filter((icon) => icon.match === "exact"),
		...drawings.filter((icon) => icon.match === "exact"),
		...marks.filter((icon) => icon.match !== "exact"),
		...drawings.filter((icon) => icon.match !== "exact"),
	].slice(0, limit);
}

const searchIconsWorkflow = Effect.fn("codeMode.searchIcons.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(SearchIconsRequest, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* SearchIconsFailure.new({
			status: "invalid_input",
			context: {
				issues: codeModeInputIssues(parsed.failure),
			},
		});
	}
	const environment = yield* BuildRuntimeEnvironment;
	const query = cleanToolString(parsed.success.q);
	const limit = parsed.success.limit ?? DEFAULT_ICON_SEARCH_LIMIT;
	const curated = environment.icons?.search(query, limit) ?? [];
	const community = environment.communityIcons
		? yield* environment.communityIcons.search(communityIconQuery(query))
		: [];
	return {
		ok: true,
		status: "accepted",
		query,
		icons: rankIconSearch(query, curated, community, limit),
		issues: environment.icons
			? []
			: [
					issue({
						code: "unknown_icon",
						severity: "warning",
						stage: "input",
						ref: { kind: "request", path: "q" },
						message: "This Sketchi runtime has no icon catalog.",
						hint: "Omit node icons on this host.",
					}),
				],
	} satisfies Extract<SearchIconsResult, { ok: true }>;
});

/** Ranked node-logo search; use a returned slug as a node `icon.slug`. */
export const searchIcons: (input: unknown) => CodeModeWorkflowEffect<SearchIconsResult> = boundary(
	"searchIcons",
	searchIconsWorkflow,
	failureResult,
);
