/**
 * Family-narrowing classifier eval: which families' rules would an untyped generate request
 * carry, routed by its words alone and by the shipped router with Jev? The label is each
 * scenario's family. Prompts run as written and reworded to name no family
 * (tools/family-narrowing-cases.json, from the rules in family-narrowing-no-cue.ts).
 *
 *   TYPESAFE_API_KEY=... pnpm eval:family-narrowing             # the tuning cases
 *   TYPESAFE_API_KEY=... pnpm eval:family-narrowing --fresh     # every call sent again
 *   TYPESAFE_API_KEY=... pnpm eval:family-narrowing --holdout <split.json>
 *                                                               # holdout totals only
 *   pnpm eval:family-narrowing cases [ids]                      # rewrite the checked-in set
 *
 * Every Jev request goes through the shipped narrowing and DecisionModel, and is cached by its
 * payload under .memory/family-narrowing/, so a rerun costs nothing and any answer can be sent
 * again. A fresh run sends one case at a time, so each call's latency is its own.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { TypeSafeClient, TypeSafeDecisionModel, type TypeSafeSchema } from "@effect/ai-typesafe";
import { NodeRuntime } from "@effect/platform-node";
import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import {
	buildDiagramGenerationMessages,
	type DiagramGenerationRequest,
	FAMILY_NARROWING_MODEL,
	type FamilyNarrowing,
	makeDiagramFamilyNarrowing,
	withFamilyRoute,
	withNarrowedFamilyRoute,
} from "@sketchi/diagram-generation";
import { diagramScenarios } from "@sketchi/diagram-scenarios";
import { Clock, Config, Context, Effect, Layer, Option, Schedule, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import { withoutFamilyNames } from "./family-narrowing-no-cue.ts";

const CASES_FILE = join(import.meta.dirname, "family-narrowing-cases.json");
const OUT_DIR = join(import.meta.dirname, "..", ".memory", "family-narrowing");
const CACHE_FILE = join(OUT_DIR, "cache.json");

// ---------------------------------------------------------------------------------------
// Cases

const CasesFile = Schema.Struct({
	description: Schema.String,
	cases: Schema.Array(
		Schema.Struct({ family: Schema.String, id: Schema.String, noCue: Schema.String }),
	),
});

const SplitFile = Schema.Struct({
	sets: Schema.Struct({ holdout: Schema.Array(Schema.String) }),
});

type CaseSet = "written" | "no-cue";

interface EvalCase {
	readonly family: DiagramTypeValue;
	readonly id: string;
	readonly prompt: string;
	readonly set: CaseSet;
}

function scenarioPrompt(id: string): { family: DiagramTypeValue; prompt: string } {
	const scenario = diagramScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown scenario ${id}.`);
	return { family: scenario.diagramType, prompt: scenario.prompt };
}

const bothSets = (id: string, noCue: string): EvalCase[] => {
	const { family, prompt } = scenarioPrompt(id);
	return [
		{ family, id, prompt, set: "written" },
		{ family, id, prompt: noCue, set: "no-cue" },
	];
};

/** The checked-in tuning cases, each checked against the rules that wrote it. */
function tuningCases(): EvalCase[] {
	const file = Schema.decodeUnknownSync(CasesFile)(JSON.parse(readFileSync(CASES_FILE, "utf8")));
	return file.cases.flatMap(({ id, noCue }) => {
		if (withoutFamilyNames(scenarioPrompt(id).prompt) !== noCue) {
			throw new Error(
				`${id}: the no-cue prompt is stale; run \`pnpm eval:family-narrowing cases\`.`,
			);
		}
		return bothSets(id, noCue);
	});
}

/** The split's holdout cases, reworded by the same rules. Never written or printed. */
function holdoutCases(splitFile: string): EvalCase[] {
	const split = Schema.decodeUnknownSync(SplitFile)(JSON.parse(readFileSync(splitFile, "utf8")));
	return split.sets.holdout.flatMap((id) =>
		bothSets(id, withoutFamilyNames(scenarioPrompt(id).prompt)),
	);
}

/** Rewrites the checked-in set for the given tuning ids. */
function writeCases(ids: readonly string[]) {
	const cases = ids.map((id) => {
		const { family, prompt } = scenarioPrompt(id);
		return { id, family, noCue: withoutFamilyNames(prompt) };
	});
	writeFileSync(
		CASES_FILE,
		`${JSON.stringify(
			{
				description:
					"The tuning split of Frontierclimb's sketchi-split-v1 (holdout is never read here), with each prompt reworded by tools/family-narrowing-no-cue.ts to name no family.",
				cases,
			},
			null,
			"\t",
		)}\n`,
	);
	return cases.length;
}

// ---------------------------------------------------------------------------------------
// Jev, cached by payload

type SystemOneResponse = typeof TypeSafeSchema.SystemOneResponse.Type;

interface CachedCall {
	readonly latencyMs: number;
	readonly payload: unknown;
	readonly response: SystemOneResponse;
}

const cache: Record<string, CachedCall> = existsSync(CACHE_FILE)
	? JSON.parse(readFileSync(CACHE_FILE, "utf8"))
	: {};
let cacheDirty = false;
function saveCache() {
	if (!cacheDirty) return;
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(CACHE_FILE, JSON.stringify(cache));
	cacheDirty = false;
}
const payloadKey = (payload: unknown) =>
	createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** Where one case learns which calls answered it, cached or not. */
class CallRecorder extends Context.Service<CallRecorder, { readonly calls: CachedCall[] }>()(
	"familyNarrowingEval/CallRecorder",
) {}

/**
 * TypeSafe's client, answering from the cache unless `fresh`. Unlike production's client it
 * waits out a rate limit, so a long run completes.
 */
const cachingTypeSafeClient = (fresh: boolean) =>
	Layer.effect(
		TypeSafeClient.TypeSafeClient,
		Effect.gen(function* () {
			const apiKey = yield* Config.option(Config.Redacted("TYPESAFE_API_KEY"));
			const live = Option.isSome(apiKey)
				? yield* TypeSafeClient.make({ apiKey: apiKey.value })
				: undefined;
			const send = (key: string, payload: typeof TypeSafeSchema.SystemOneRequest.Encoded) =>
				Effect.gen(function* () {
					if (!live) {
						return yield* Effect.die(`TYPESAFE_API_KEY is not set, and ${key} is not cached.`);
					}
					const startedAt = yield* Clock.currentTimeMillis;
					const response = yield* live.systemOne(payload).pipe(
						Effect.retry({
							schedule: Schedule.exponential("500 millis"),
							times: 6,
							while: (error) => error.reason._tag === "RateLimitError",
						}),
					);
					const call = {
						latencyMs: (yield* Clock.currentTimeMillis) - startedAt,
						payload,
						response,
					};
					cache[key] = call;
					cacheDirty = true;
					return call;
				});
			return TypeSafeClient.TypeSafeClient.of({
				client: live?.client ?? (yield* HttpClient.HttpClient),
				listModels: () => (live ? live.listModels() : Effect.die("TYPESAFE_API_KEY is not set.")),
				systemOne: (payload) =>
					Effect.gen(function* () {
						const key = payloadKey(payload);
						const call = (fresh ? undefined : cache[key]) ?? (yield* send(key, payload));
						const recorder = yield* Effect.serviceOption(CallRecorder);
						if (Option.isSome(recorder)) recorder.value.calls.push(call);
						return call.response;
					}),
			});
		}),
	).pipe(Layer.provide(FetchHttpClient.layer));

const jev = (fresh: boolean) =>
	TypeSafeDecisionModel.layer({ model: FAMILY_NARROWING_MODEL }).pipe(
		Layer.provide(cachingTypeSafeClient(fresh)),
	);

// ---------------------------------------------------------------------------------------
// Routing each case

type Router = "words" | "words+jev";

interface Result {
	readonly calls: readonly CachedCall[];
	readonly case: EvalCase;
	/** The families the prompt carries; empty for every family's rules. */
	readonly families: readonly DiagramTypeValue[];
	readonly narrowing: FamilyNarrowing | undefined;
	readonly router: Router;
	readonly systemChars: number;
}

const untyped = (evalCase: EvalCase): DiagramGenerationRequest => ({
	model: "eval",
	prompt: { id: evalCase.id, request: evalCase.prompt },
});

const resultOf = (
	evalCase: EvalCase,
	router: Router,
	routed: { readonly request: DiagramGenerationRequest; readonly narrowing?: FamilyNarrowing },
	route: { readonly families: readonly DiagramTypeValue[] } | undefined,
	calls: readonly CachedCall[],
): Result => ({
	calls,
	case: evalCase,
	families: route?.families ?? [],
	narrowing: routed.narrowing,
	router,
	systemChars: buildDiagramGenerationMessages(routed.request.prompt).system.length,
});

const routeAll = Effect.fn("familyNarrowingEval.routeAll")(function* (
	cases: readonly EvalCase[],
	fresh: boolean,
) {
	const narrowing = yield* makeDiagramFamilyNarrowing({ timeoutMs: 3_000 });
	const byWords = cases.map((evalCase) => {
		const routed = withFamilyRoute(untyped(evalCase));
		return resultOf(evalCase, "words", routed, routed.route, []);
	});
	const withJev = yield* Effect.forEach(
		cases,
		(evalCase) =>
			Effect.gen(function* () {
				const recorder = { calls: [] as CachedCall[] };
				const routed = yield* withNarrowedFamilyRoute(untyped(evalCase), narrowing).pipe(
					Effect.provideService(CallRecorder, recorder),
				);
				return resultOf(evalCase, "words+jev", routed, routed.route, recorder.calls);
			}),
		// One at a time when calls are sent, so each call's latency is its own.
		{ concurrency: fresh ? 1 : 4 },
	);
	return [...byWords, ...withJev];
});

// ---------------------------------------------------------------------------------------
// Report

const mean = (values: readonly number[]) =>
	values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = (values: readonly number[], q: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
const percent = (part: number, whole: number) =>
	whole === 0 ? "-" : `${((100 * part) / whole).toFixed(1)}%`;

function summarize(results: readonly Result[]) {
	const n = results.length;
	const keepsFamily = (result: Result) =>
		result.families.length === 0 || result.families.includes(result.case.family);
	const one = results.filter((result) => result.families.length === 1);
	const asked = results.filter((result) => result.calls.length > 0);
	const callsMs = asked.map((result) =>
		result.calls.reduce((sum, call) => sum + call.latencyMs, 0),
	);
	const tokens = (key: "input_tokens" | "output_tokens") =>
		Math.round(
			mean(
				asked.map((result) =>
					result.calls.reduce((sum, call) => sum + (call.response.usage?.[key] ?? 0), 0),
				),
			),
		);
	return {
		n,
		one: `${one.length} (${one.filter((result) => result.families[0] === result.case.family).length} right)`,
		several: results.filter((result) => result.families.length > 1).length,
		full: results.filter((result) => result.families.length === 0).length,
		recall: percent(results.filter(keepsFamily).length, n),
		wrong: results.filter((result) => !keepsFamily(result)).length,
		families: mean(results.map((result) => result.families.length || DIAGRAM_TYPES.length)).toFixed(
			2,
		),
		systemChars: Math.round(mean(results.map((result) => result.systemChars))),
		jevAsked: asked.length,
		jevFailed: results.filter((result) => result.narrowing?._tag === "Failed").length,
		jevCalls:
			asked.length === 0 ? "-" : mean(asked.map((result) => result.calls.length)).toFixed(2),
		jevP50Ms: asked.length === 0 ? "-" : Math.round(quantile(callsMs, 0.5)),
		jevP95Ms: asked.length === 0 ? "-" : Math.round(quantile(callsMs, 0.95)),
		jevInputTokens: asked.length === 0 ? "-" : tokens("input_tokens"),
		jevOutputTokens: asked.length === 0 ? "-" : tokens("output_tokens"),
	};
}

function report(results: readonly Result[]) {
	const table = [];
	for (const set of ["written", "no-cue"] as const) {
		for (const router of ["words", "words+jev"] as const) {
			const group = results.filter((result) => result.case.set === set && result.router === router);
			table.push({ set, router, ...summarize(group) });
		}
	}
	console.table(table);
}

/** Per-case routes, written for tuning cases only. */
function writeRows(results: readonly Result[]) {
	mkdirSync(OUT_DIR, { recursive: true });
	const file = join(OUT_DIR, "rows.json");
	writeFileSync(
		file,
		JSON.stringify(
			results.map((result) => ({
				family: result.case.family,
				families: result.families,
				id: result.case.id,
				narrowing: result.narrowing,
				router: result.router,
				set: result.case.set,
			})),
			null,
			1,
		),
	);
	console.log(`Rows in ${file}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const [command, ...rest] = process.argv.slice(2);
	if (command === "cases") {
		const ids =
			rest.length > 0
				? rest
				: Schema.decodeUnknownSync(CasesFile)(
						JSON.parse(readFileSync(CASES_FILE, "utf8")),
					).cases.map((entry) => entry.id);
		console.log(`Wrote ${writeCases(ids)} cases to ${CASES_FILE}.`);
	} else {
		const args = process.argv.slice(2);
		const fresh = args.includes("--fresh");
		const holdoutAt = args.indexOf("--holdout");
		const splitFile = holdoutAt >= 0 ? args[holdoutAt + 1] : undefined;
		if (holdoutAt >= 0 && !splitFile) throw new Error("--holdout needs the split.json path.");
		const cases = splitFile ? holdoutCases(splitFile) : tuningCases();
		NodeRuntime.runMain(
			routeAll(cases, fresh).pipe(
				Effect.tap((results) =>
					Effect.sync(() => {
						report(results);
						if (!splitFile) writeRows(results);
					}),
				),
				Effect.provide(jev(fresh)),
				Effect.ensuring(Effect.sync(saveCache)),
			),
		);
	}
}
