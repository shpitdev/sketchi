import "@tanstack/react-start/server-only";

import {
	MAX_DIAGRAM_BUILD_ATTEMPTS,
	normalizeIconSlug,
	type BuildFlowchartOptions,
	type CodeModeIssue,
} from "@sketchi/diagram-agent";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagram-generation";
import { recordMetric } from "@sketchi/observability";
import { Effect, Metric, Ref, Semaphore } from "effect";

/** Studio renders the inline scene and offers the Excalidraw download. */
export const STUDIO_ARTIFACT_OPTIONS: NonNullable<BuildFlowchartOptions> = {
	artifactFormats: ["scene", "excalidraw"],
	inlineArtifacts: ["scene"],
};

const studioBuildRetries = Metric.counter("sketchi_chat_build_retries", {
	description: "Studio chat diagram repair attempts",
	incremental: true,
});

/** The shape every canonical Code Mode build result shares. */
interface StudioBuildResult {
	readonly ok: boolean;
	readonly issues: readonly CodeModeIssue[];
}

export interface StudioBuildToolExecutor<Input, Result, E = never, R = never> {
	readonly attempts: Effect.Effect<number>;
	readonly execute: (input: Input) => Effect.Effect<Result, E, R>;
}

type StudioBuildOperation = "buildFlowchart" | "buildSequenceDiagram";

/**
 * One agent turn's build budget, shared by every Studio build tool: one
 * attempt counter, one accepted artifact, and one build at a time.
 */
export interface StudioBuildTurn {
	readonly maxAttempts: number;
	readonly semaphore: Semaphore.Semaphore;
	readonly state: Ref.Ref<{
		readonly accepted?: {
			readonly operation: StudioBuildOperation;
			readonly result: StudioBuildResult;
		};
		readonly attempts: number;
	}>;
}

export function makeStudioBuildTurn(
	maxAttempts: number = MAX_DIAGRAM_BUILD_ATTEMPTS,
): Effect.Effect<StudioBuildTurn> {
	return Effect.gen(function* () {
		return {
			maxAttempts,
			semaphore: yield* Semaphore.make(1),
			state: yield* Ref.make<StudioBuildTurn["state"] extends Ref.Ref<infer A> ? A : never>({
				attempts: 0,
			}),
		};
	});
}

export const attemptLimitIssue: CodeModeIssue = {
	code: "quality_below_threshold",
	severity: "error",
	stage: "quality",
	ref: { kind: "request", path: "spec" },
	message: "The diagram still needs changes before it can be shared.",
	hint: "Explain that the draft needs another pass and invite the user to simplify or clarify the request.",
};

export const turnAlreadyAcceptedIssue: CodeModeIssue = {
	code: "quality_below_threshold",
	severity: "error",
	stage: "quality",
	ref: { kind: "request", path: "spec" },
	message: "A diagram was already saved for this request.",
	hint: "Do not build another diagram this turn. Describe the saved diagram and offer one refinement.",
};

interface LogoElement {
	readonly icon?: { readonly slug: string } | undefined;
	readonly id: string;
	readonly label: string;
}

/**
 * Place the user's named logos on the flowchart nodes or sequence participants
 * whose labels name them, and drop logos for technologies the user never
 * named, before the build.
 */
export function groundOfferedLogos<Element extends LogoElement>(
	elements: readonly Element[],
	logos: readonly OfferedLogo[],
	owner: { readonly noun: "node" | "participant"; readonly path: "nodes" | "participants" },
): {
	readonly changed: boolean;
	readonly elements: Element[];
	readonly issues: CodeModeIssue[];
} {
	const offered = new Set(logos.map((logo) => logo.slug));
	const issues: CodeModeIssue[] = elements.flatMap((element) =>
		element.icon && !offered.has(normalizeIconSlug(element.icon.slug))
			? [
					{
						code: "unknown_icon" as const,
						severity: "warning" as const,
						stage: "input" as const,
						ref: {
							kind: "node" as const,
							id: element.id,
							path: `${owner.path}.icon.slug`,
						},
						message: `Icon "${element.icon.slug}" on ${owner.noun} "${element.id}" is not a technology the user named; the ${owner.noun} renders without a logo.`,
						hint: "Only use logos from the NODE LOGOS list.",
					},
				]
			: [],
	);
	const placement = placeNodeLogos(
		elements.map((element) =>
			element.icon ? { ...element, icon: { slug: normalizeIconSlug(element.icon.slug) } } : element,
		),
		logos,
		owner.noun,
	);
	return {
		changed: placement.diagnostics.length > 0 || issues.length > 0,
		elements: placement.nodes,
		issues,
	};
}

/**
 * Per-agent-turn guard around one canonical Code Mode build. Studio owns only
 * the attempt budget, artifact options, and optional input grounding;
 * validation, quality, rendering, exporting, and persistence remain the shared
 * build vertical. Tools that share a turn share its budget: an accepted result
 * is reused by its own tool and ends building for every other tool.
 */
export function makeStudioBuildToolExecutor<
	Input extends object,
	Result extends StudioBuildResult,
	E,
	R,
>(options: {
	readonly build: (input: unknown) => Effect.Effect<Result, E, R>;
	/** This tool's rejected result carrying one issue. */
	readonly rejected: (issue: CodeModeIssue) => Result;
	readonly operation: StudioBuildOperation;
	readonly ground?: (input: Input) => {
		readonly input: Input;
		readonly issues: readonly CodeModeIssue[];
	};
	readonly turn?: StudioBuildTurn;
}): Effect.Effect<StudioBuildToolExecutor<Input, Result, E, R>> {
	return Effect.gen(function* () {
		const turn = options.turn ?? (yield* makeStudioBuildTurn());
		const { semaphore, state } = turn;

		const execute = Effect.fn(`playground.chat.${options.operation}.execute`)((input: Input) =>
			semaphore.withPermit(
				Effect.gen(function* () {
					const current = yield* Ref.get(state);
					if (current.accepted) {
						// The accepted result has this tool's result type when it is this tool's.
						return current.accepted.operation === options.operation
							? (current.accepted.result as Result)
							: options.rejected(turnAlreadyAcceptedIssue);
					}
					if (current.attempts >= turn.maxAttempts) {
						return options.rejected(attemptLimitIssue);
					}

					const attempt = current.attempts + 1;
					if (attempt > 1) {
						yield* recordMetric(studioBuildRetries, 1, {
							operation: options.operation,
							retryKind: "repair",
							surface: "chat",
						});
						yield* Effect.logInfo("Retrying Studio diagram repair", {
							attempt,
							operation: options.operation,
							retry_kind: "repair",
							surface: "chat",
						});
					}

					yield* Ref.update(state, (value) => ({
						...value,
						attempts: value.attempts + 1,
					}));
					const grounded = options.ground?.(input) ?? { input, issues: [] };
					const built = yield* options.build({
						...grounded.input,
						options: STUDIO_ARTIFACT_OPTIONS,
					});
					const result: Result =
						grounded.issues.length > 0
							? { ...built, issues: [...grounded.issues, ...built.issues] }
							: built;
					if (result.ok) {
						yield* Ref.update(state, (value) => ({
							...value,
							accepted: { operation: options.operation, result },
						}));
					}
					return result;
				}),
			),
		);

		return {
			attempts: Ref.get(state).pipe(Effect.map((value) => value.attempts)),
			execute,
		};
	});
}
