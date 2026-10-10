import "@tanstack/react-start/server-only";

import { Schema } from "effect";

import { catalog, type CatalogEntry } from "./mcp-docs/catalog";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";

const CodeModeDocsTopicContract = Schema.Literals([
	"overview",
	"execute",
	"buildFlowchart",
	"buildMindmap",
	"buildSequenceDiagram",
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
export const CodeModeDocsRequestSchema = toPlaygroundStandardSchema(CodeModeDocsRequestContract);
export type CodeModeDocsRequest = typeof CodeModeDocsRequestContract.Type;

const NonEmptyString = Schema.String.check(
	Schema.isMinLength(1, {
		message: "Too small: expected string to have >=1 characters",
	}),
);
const CodeModeSearchLimit = Schema.Int.check(
	Schema.isGreaterThanOrEqualTo(1, {
		message: "Too small: expected number to be >=1",
	}),
	Schema.isLessThanOrEqualTo(20, {
		message: "Too big: expected number to be <=20",
	}),
);
const CodeModeSearchRequestContract = Schema.Struct({
	query: NonEmptyString,
	limit: Schema.optionalKey(CodeModeSearchLimit),
});
export const CodeModeSearchRequestSchema = toPlaygroundStandardSchema(
	CodeModeSearchRequestContract,
);
export type CodeModeSearchRequest = typeof CodeModeSearchRequestContract.Type;

const CodeExampleContract = Schema.Struct({
	title: Schema.String,
	language: Schema.Literals(["js", "json", "ts"]),
	code: Schema.String,
});
export const CodeExampleSchema = toPlaygroundStandardSchema(CodeExampleContract);
export type CodeExample = typeof CodeExampleContract.Type;

const CodeModeDocsResultContract = Schema.Struct({
	topic: CodeModeDocsTopicContract,
	content: Schema.String,
	examples: Schema.Array(CodeExampleContract).pipe(Schema.mutable),
	version: Schema.String,
});
export const CodeModeDocsResultSchema = toPlaygroundStandardSchema(CodeModeDocsResultContract);
export type DocsResult = typeof CodeModeDocsResultContract.Type & Record<string, unknown>;

const CodeModeSearchHitContract = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["operation", "schema", "issue", "example", "non_goal"]),
	title: Schema.String,
	snippet: Schema.String,
	score: Schema.Finite,
});
export const CodeModeSearchHitSchema = toPlaygroundStandardSchema(CodeModeSearchHitContract);
export type SearchHit = typeof CodeModeSearchHitContract.Type;

const CodeModeSearchResultContract = Schema.Struct({
	query: Schema.String,
	results: Schema.Array(CodeModeSearchHitContract).pipe(Schema.mutable),
});
export const CodeModeSearchResultSchema = toPlaygroundStandardSchema(CodeModeSearchResultContract);
export type SearchResult = typeof CodeModeSearchResultContract.Type & Record<string, unknown>;

export const SKETCHI_CODE_MODE_VERSION = "2026-09-04";

export { default as SKETCHI_CODE_MODE_TYPES } from "./mcp-docs/code-mode-types.generated.txt?raw";

function docsEntryForTopic(topic: DocsResult["topic"]): CatalogEntry {
	const fallback = catalog.find((entry) => entry.id === "overview");
	const entry = catalog.find((entry) => entry.topic === topic) ?? fallback;

	if (!entry) {
		throw new Error("Code Mode docs catalog is missing an overview entry.");
	}

	return entry;
}

function scoreEntry(entry: CatalogEntry, terms: string[]): number {
	const haystack = [
		entry.id,
		entry.kind,
		entry.title,
		entry.topic,
		entry.snippet,
		entry.content,
		...entry.keywords,
	]
		.join(" ")
		.toLowerCase();

	return terms.reduce((score, term) => {
		if (entry.id.toLowerCase() === term || entry.topic.toLowerCase() === term) {
			return score + 12;
		}
		if (entry.keywords.some((keyword) => keyword.toLowerCase() === term)) {
			return score + 8;
		}
		return haystack.includes(term) ? score + 1 : score;
	}, 0);
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

export function searchCodeModeDocs(input: CodeModeSearchRequest): SearchResult {
	const terms = input.query
		.toLowerCase()
		.split(/[^a-z0-9_#-]+/)
		.filter(Boolean);
	const limit = input.limit ?? 8;
	const results = catalog
		.map((entry) => ({
			id: entry.id,
			kind: entry.kind,
			title: entry.title,
			snippet: entry.snippet,
			score: scoreEntry(entry, terms),
		}))
		.filter((hit) => hit.score > 0)
		.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
		.slice(0, limit);

	return {
		query: input.query,
		results,
	};
}
