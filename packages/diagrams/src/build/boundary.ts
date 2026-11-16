import { families } from "../family";

import {
	recordMetric,
	withTelemetryCorrelation,
	type TelemetryCorrelationInput,
} from "@sketchi/observability";
import { Clock, Effect, Metric, Result } from "effect";

import { type CodeModeArtifactStorage } from "./artifacts";
import { type CodeModeRuntimeEnvironment } from "./runtime";

const codeModeRequests = Metric.counter("sketchi_codemode_requests", {
	description: "Code Mode boundary requests by terminal outcome",
	incremental: true,
});
const codeModeFailures = Metric.counter("sketchi_codemode_failures", {
	description: "Code Mode boundary failures by typed status",
	incremental: true,
});
const codeModeArtifacts = Metric.counter("sketchi_codemode_artifacts", {
	description: "Code Mode artifacts accepted at workflow boundaries",
	incremental: true,
});
const codeModeDuration = Metric.histogram("sketchi_codemode_duration_ms", {
	description: "Code Mode boundary duration in milliseconds",
	boundaries: Metric.boundariesFromIterable([
		1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
	]),
});

export function unknownRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}

export interface ObservableCodeModeResult {
	readonly ok: boolean;
	readonly status?: string;
}

function codeModeCorrelation(input: unknown): TelemetryCorrelationInput {
	const record = unknownRecord(input);
	const source = unknownRecord(record?.["source"]);
	const artifactId =
		typeof record?.["artifactId"] === "string"
			? record["artifactId"]
			: typeof source?.["artifactId"] === "string"
				? source["artifactId"]
				: undefined;
	const requestId = typeof record?.["requestId"] === "string" ? record["requestId"] : undefined;
	return {
		...(artifactId ? { artifactId } : {}),
		...(requestId ? { requestId } : {}),
	};
}

function artifactKindForOperation(operation: string): string | undefined {
	if (operation === "createCanvas") return "canvas";
	if (operation === "applyDiagramPatch") return "patch";
	return families.find((family) => family.operation === operation)?.type;
}

export function observeCodeModeBoundary<
	A extends ObservableCodeModeResult,
	E extends { readonly status: string },
	R,
>(
	operation: string,
	input: unknown,
	effect: Effect.Effect<A, E, R>,
	options: {
		/** Preparation observes rejections; its successful continuation owns the build metrics. */
		readonly recordSuccess?: boolean;
	} = {},
): Effect.Effect<A, E, R> {
	const observed = Effect.gen(function* () {
		const startedAt = yield* Clock.currentTimeMillis;
		const outcomeResult = yield* Effect.result(effect);
		const result = Result.isSuccess(outcomeResult)
			? outcomeResult.success
			: { ok: false, status: outcomeResult.failure.status };
		if (result.ok && options.recordSuccess === false)
			return yield* Effect.fromResult(outcomeResult);
		const finishedAt = yield* Clock.currentTimeMillis;
		const outcome = result.ok ? "success" : "failure";
		const failureCategory = result.ok ? undefined : (result.status ?? "unknown_failure");
		yield* recordMetric(codeModeRequests, 1, {
			...(failureCategory ? { failureCategory } : {}),
			operation,
			outcome,
			surface: "code_mode",
		});
		yield* recordMetric(codeModeDuration, finishedAt - startedAt, {
			...(failureCategory ? { failureCategory } : {}),
			operation,
			outcome,
			surface: "code_mode",
		});
		if (failureCategory) {
			yield* recordMetric(codeModeFailures, 1, {
				failureCategory,
				operation,
				surface: "code_mode",
			});
		}
		const artifactKind = artifactKindForOperation(operation);
		if (result.ok && artifactKind) {
			yield* recordMetric(codeModeArtifacts, 1, {
				artifactKind,
				operation,
				surface: "code_mode",
			});
		}
		return yield* Effect.fromResult(outcomeResult);
	});
	return withTelemetryCorrelation(observed, codeModeCorrelation(input));
}

export type CodeModeWorkflowEffect<A> = Effect.Effect<
	A,
	never,
	CodeModeArtifactStorage | CodeModeRuntimeEnvironment
>;

export function boundary<A extends ObservableCodeModeResult, E, B extends ObservableCodeModeResult>(
	operation: string,
	workflow: (
		input: unknown,
	) => Effect.Effect<A, E, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	onFailure: (error: E) => B,
): (input: unknown) => CodeModeWorkflowEffect<A | B> {
	return Effect.fn(`codeMode.${operation}`)((input: unknown) =>
		observeCodeModeBoundary(
			operation,
			input,
			workflow(input).pipe(Effect.match({ onFailure, onSuccess: (result) => result })),
		),
	);
}
