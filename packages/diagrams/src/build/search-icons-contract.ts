import { BuildIssue } from "./result";

import { Schema } from "effect";

import {
	booleanLiteral,
	literals,
	nonEmptyString,
	optionalContract,
	requiredString,
	stringLiteral,
} from "./schema";

const maximumIconQueryLength = 120;
const minimumIconSearchLimit = 1;
const maximumIconSearchLimit = 25;
export const DEFAULT_ICON_SEARCH_LIMIT = 10;

/** Ranked search over the logos a node may carry (a node `icon.slug`). */
export const SearchIconsRequest = Schema.Struct({
	q: requiredString(
		nonEmptyString().check(
			Schema.isMaxLength(maximumIconQueryLength, {
				message: `Too big: expected string to have <=${maximumIconQueryLength} characters`,
			}),
		),
	),
	limit: optionalContract(
		Schema.Int.check(
			Schema.isBetween(
				{
					minimum: minimumIconSearchLimit,
					maximum: maximumIconSearchLimit,
				},
				{
					message: `Expected an integer between ${minimumIconSearchLimit} and ${maximumIconSearchLimit}`,
				},
			),
		),
	),
}).annotate({ identifier: undefined });

export interface SearchIconsRequest extends Schema.Schema.Type<typeof SearchIconsRequest> {}

export const SearchIconsMatch = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	collection: Schema.String,
	/** exact: the product's own mark; vendor: its vendor's or platform's; weak: fuzzier. */
	match: literals(["exact", "vendor", "weak"]),
}).annotate({ identifier: undefined });

export interface SearchIconsMatch extends Schema.Schema.Type<typeof SearchIconsMatch> {}

export const SearchIconsAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	query: Schema.String,
	icons: Schema.Array(SearchIconsMatch).pipe(Schema.mutable),
	issues: Schema.Array(BuildIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface SearchIconsAccepted extends Schema.Schema.Type<typeof SearchIconsAccepted> {}

export const SearchIconsRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals(["invalid_input"]),
	issues: Schema.Array(BuildIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface SearchIconsRejected extends Schema.Schema.Type<typeof SearchIconsRejected> {}

export const SearchIconsResultSchema = Schema.Union([SearchIconsAccepted, SearchIconsRejected]);
export type SearchIconsResult = typeof SearchIconsResultSchema.Type;
