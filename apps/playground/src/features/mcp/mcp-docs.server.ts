import {
	Array as Arr,
	Option as Opt,
	String as Str,
	Order as Ord,
	Predicate,
	Schema,
} from "effect";
import { FAMILY_BUILD_OPERATIONS } from "@sketchi/diagrams/family";
import "@tanstack/react-start/server-only";
import { catalog, type CatalogEntry } from "./mcp-docs/catalog";
const CodeModeDocsTopicContract = Schema.Literals([
	"overview",
	"execute",
	...FAMILY_BUILD_OPERATIONS,
	"createCanvas",
	"getArtifact",
	"applyDiagramPatch",
	"patchOperations",
	"agentSequence",
	"issues",
	"examples",
]).annotate({ default: "overview" });
const CodeModeDocsRequestContract = Schema.Struct({
	topic: Schema.optionalKey(CodeModeDocsTopicContract),
});
export const CodeModeDocsRequestSchema = CodeModeDocsRequestContract;
export type CodeModeDocsRequest = typeof CodeModeDocsRequestContract.Type;
const CodeModeSearchLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }));
const CodeModeSearchRequestContract = Schema.Struct({
	query: Schema.NonEmptyString,
	limit: Schema.optionalKey(CodeModeSearchLimit),
});
export const CodeModeSearchRequestSchema = CodeModeSearchRequestContract;
export type CodeModeSearchRequest = typeof CodeModeSearchRequestContract.Type;
const CodeExampleContract = Schema.Struct({
	title: Schema.String,
	language: Schema.Literals(["js", "json", "ts"]),
	code: Schema.String,
});
export type CodeExample = typeof CodeExampleContract.Type;
const CodeModeDocsResultContract = Schema.Struct({
	topic: CodeModeDocsTopicContract,
	content: Schema.String,
	examples: Schema.Array(CodeExampleContract).pipe(Schema.mutable),
	version: Schema.String,
});
export const CodeModeDocsResultSchema = CodeModeDocsResultContract;
export type DocsResult = typeof CodeModeDocsResultContract.Type & Record<string, unknown>;
const CodeModeSearchHitContract = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["operation", "schema", "issue", "example", "non_goal"]),
	title: Schema.String,
	snippet: Schema.String,
	score: Schema.Finite,
});
export type SearchHit = typeof CodeModeSearchHitContract.Type;
const CodeModeSearchResultContract = Schema.Struct({
	query: Schema.String,
	results: Schema.Array(CodeModeSearchHitContract).pipe(Schema.mutable),
});
export const CodeModeSearchResultSchema = CodeModeSearchResultContract;
export type SearchResult = typeof CodeModeSearchResultContract.Type & Record<string, unknown>;
export const SKETCHI_CODE_MODE_VERSION = "2026-09-04";
export {
	EXECUTE_DESCRIPTION_LEGACY_WINDOW,
	EXECUTE_DESCRIPTION_WINDOW,
	EXECUTE_CODE_DESCRIPTION as SKETCHI_EXECUTE_CODE_DESCRIPTION,
	EXECUTE_TOOL_DESCRIPTION as SKETCHI_EXECUTE_DESCRIPTION,
} from "./mcp-docs/catalog";
export { default as SKETCHI_CODE_MODE_TYPES } from "./mcp-docs/code-mode-types.generated.txt?raw";
function docsEntryForTopic(topic: DocsResult["topic"]): CatalogEntry {
	const fallback = Opt.getOrUndefined(Arr.findFirst(catalog, (entry) => entry.id === "overview"));
	const entry =
		Opt.getOrUndefined(Arr.findFirst(catalog, (entry) => entry.topic === topic)) ?? fallback;
	if (!entry) {
		throw new Error("Code Mode docs catalog is missing an overview entry.");
	}
	return entry;
}
function scoreEntry(entry: CatalogEntry, terms: string[]): number {
	const haystack = Str.toLowerCase(
		Arr.join(
			[
				entry.id,
				entry.kind,
				entry.title,
				entry.topic,
				entry.snippet,
				entry.content,
				...entry.keywords,
			],
			" ",
		),
	);
	return Arr.reduce(terms, 0, (score, term) => {
		if (Str.toLowerCase(entry.id) === term || Str.toLowerCase(entry.topic) === term) {
			return score + 12;
		}
		if (Arr.some(entry.keywords, (keyword) => Str.toLowerCase(keyword) === term)) {
			return score + 8;
		}
		return Str.includes(term)(haystack) ? score + 1 : score;
	});
}
export function getCodeModeDocs(input: CodeModeDocsRequest): DocsResult {
	const topic = input.topic ?? "overview";
	const entry = docsEntryForTopic(topic);
	return {
		topic,
		content: entry.content,
		examples: entry.examples ?? [],
		version: SKETCHI_CODE_MODE_VERSION,
	};
}
/** Models read docs as text: types and examples escaped inside a JSON string cost tokens and clarity. */
export function formatCodeModeDocs(docs: unknown): string | undefined {
	if (!Predicate.isObject(docs) || typeof docs.content !== "string" || !Arr.isArray(docs.examples))
		return undefined;
	return Arr.join(
		[
			docs.content,
			...Arr.flatMap(docs.examples, (example) => {
				if (
					!Predicate.isObject(example) ||
					typeof example.title !== "string" ||
					typeof example.language !== "string" ||
					typeof example.code !== "string"
				)
					return [];
				return [`Example: ${example.title}\n\`\`\`${example.language}\n${example.code}\n\`\`\``];
			}),
		],
		"\n\n",
	);
}
export function searchCodeModeDocs(input: CodeModeSearchRequest): SearchResult {
	const terms = Arr.filter(Str.split(Str.toLowerCase(input.query), /[^a-z0-9_#-]+/), Boolean);
	const limit = input.limit ?? 8;
	const results = Arr.take(
		Arr.sort(
			Arr.filter(
				Arr.map(catalog, (entry) => ({
					id: entry.id,
					kind: entry.kind,
					title: entry.title,
					snippet: entry.snippet,
					score: scoreEntry(entry, terms),
				})),
				(hit) => hit.score > 0,
			),
			Ord.make(
				(left: SearchHit, right: SearchHit) =>
					Ord.Number(right.score, left.score) || Ord.String(left.id, right.id),
			),
		),
		limit,
	);
	return {
		query: input.query,
		results,
	};
}
