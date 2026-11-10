import "@tanstack/react-start/server-only";

import {
	MAX_DIAGRAM_BUILD_ATTEMPTS,
	normalizeIconSlug,
	type BuildFlowchartOptions,
	type CodeModeIssue,
} from "@sketchi/diagram-agent";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagram-generation";
import { recordMetric } from "@sketchi/observability";
import type { JSONValue } from "ai";
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

type StudioBuildOperation =
	| "buildFlowchart"
	| "buildMindmap"
	| "buildSequenceDiagram"
	| "buildTimeline"
	| "buildChart"
	| "buildStateMachine"
	| "buildGantt"
	| "buildErDiagram"
	| "buildClassDiagram"
	| "buildOrgChart"
	| "buildVennDiagram"
	| "buildJourneyMap"
	| "buildSankey"
	| "buildWireframe"
	| "buildQuadrantChart";

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
			/** The accepted build lists fixes its own tool may make in one more build this turn. */
			readonly open?: boolean;
		};
		readonly attempts: number;
		/** The issues of the turn's last rejected build, which the reply shows when nothing was saved. */
		readonly rejected?: readonly CodeModeIssue[];
	}>;
}

/** What one turn's builds came to: whether any was saved, and the last rejection. */
export interface StudioTurnOutcome {
	readonly attempts: number;
	readonly saved: boolean;
	readonly rejected: readonly CodeModeIssue[];
}

export function studioTurnOutcome(turn: StudioBuildTurn): Effect.Effect<StudioTurnOutcome> {
	return Ref.get(turn.state).pipe(
		Effect.map((value) => ({
			attempts: value.attempts,
			saved: value.accepted !== undefined,
			rejected: value.rejected ?? [],
		})),
	);
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

/**
 * What the model reads of a build: whether it was accepted, the saved artifact, and what to fix,
 * each issue and failed quality check with the element it names. The scene, its files and the
 * normalized spec stay with the client; the model already has the spec it sent in its own tool
 * call.
 */
export interface StudioModelResult {
	readonly ok: boolean;
	readonly status?: string;
	readonly buildId?: string;
	readonly artifactId?: string;
	readonly issues: readonly {
		readonly code: string;
		readonly severity?: string;
		readonly stage?: string;
		readonly ref?: StudioModelRef;
		readonly message: string;
		readonly hint?: string;
	}[];
	/** The quality gate's verdict and the checks it failed, each with the elements it names. */
	readonly quality?: {
		readonly accepted: boolean;
		readonly score?: number;
		readonly threshold?: number;
		readonly failed: readonly {
			readonly code: string;
			readonly severity?: string;
			readonly message: string;
			readonly refs: readonly StudioModelRef[];
		}[];
	};
}

/** Which element an issue is about: "spec.nodes.blank" says which node to fix. */
export type StudioModelRef = {
	readonly kind?: string;
	readonly id?: string;
	readonly path?: string;
};

function field(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function compactRef(ref: unknown): StudioModelRef | undefined {
	const kind = text(field(ref, "kind"));
	const id = text(field(ref, "id"));
	const path = text(field(ref, "path"));
	return kind || id || path
		? { ...(kind ? { kind } : {}), ...(id ? { id } : {}), ...(path ? { path } : {}) }
		: undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactQuality(quality: unknown): StudioModelResult["quality"] {
	if (typeof field(quality, "accepted") !== "boolean") return undefined;
	const score = number(field(quality, "score"));
	const threshold = number(field(quality, "threshold"));
	const checks = field(quality, "checks");
	return {
		accepted: field(quality, "accepted") === true,
		...(score === undefined ? {} : { score }),
		...(threshold === undefined ? {} : { threshold }),
		failed: (Array.isArray(checks) ? checks : [])
			.filter((check: unknown) => field(check, "passed") === false)
			.map((check: unknown) => {
				const severity = text(field(check, "severity"));
				const refs = field(check, "refs");
				return {
					code: text(field(check, "code")) ?? "check",
					...(severity ? { severity } : {}),
					message: text(field(check, "message")) ?? "",
					refs: (Array.isArray(refs) ? refs : []).flatMap((ref: unknown) => {
						const compact = compactRef(ref);
						return compact ? [compact] : [];
					}),
				};
			}),
	};
}

export function studioModelResult(result: unknown): StudioModelResult {
	const status = text(field(result, "status"));
	const buildId = text(field(result, "buildId"));
	const artifactId = text(field(field(result, "artifact"), "artifactId"));
	const issues = field(result, "issues");
	const quality = compactQuality(field(result, "quality"));
	return {
		ok: field(result, "ok") === true,
		...(status ? { status } : {}),
		...(buildId ? { buildId } : {}),
		...(artifactId ? { artifactId } : {}),
		issues: (Array.isArray(issues) ? issues : []).map((issue: unknown) => {
			const severity = text(field(issue, "severity"));
			const stage = text(field(issue, "stage"));
			const ref = compactRef(field(issue, "ref"));
			const hint = text(field(issue, "hint"));
			return {
				code: text(field(issue, "code")) ?? "issue",
				...(severity ? { severity } : {}),
				...(stage ? { stage } : {}),
				...(ref ? { ref } : {}),
				message: text(field(issue, "message")) ?? "",
				...(hint ? { hint } : {}),
			};
		}),
		...(quality ? { quality } : {}),
	};
}

/** A Studio build tool's toModelOutput: the compact result, in this turn and in replayed history. */
export function studioBuildModelOutput({ output }: { readonly output: unknown }): {
	readonly type: "json";
	readonly value: JSONValue;
} {
	return { type: "json", value: { ...studioModelResult(output) } };
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
	/** Studio's models name logos by slug; an icon without one draws nothing here. */
	readonly icon?: { readonly slug?: string | undefined } | undefined;
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
		element.icon && !offered.has(normalizeIconSlug(element.icon.slug ?? ""))
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
						message: `Icon "${element.icon.slug ?? "drawn"}" on ${owner.noun} "${element.id}" is not a technology the user named; the ${owner.noun} renders without a logo.`,
						hint: "Only use logos from the NODE LOGOS list.",
					},
				]
			: [],
	);
	const placement = placeNodeLogos(
		elements.map((element) => {
			const slug = element.icon?.slug;
			if (slug) return { ...element, icon: { slug: normalizeIconSlug(slug) } };
			const { icon: _icon, ...rest } = element;
			return rest;
		}),
		logos,
		owner.noun,
	);
	return {
		changed: placement.diagnostics.length > 0 || issues.length > 0,
		elements: placement.nodes as unknown as Element[],
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
	/**
	 * An accepted result that misses what the request states (a flowchart checked against the
	 * user's message) leaves the turn open for one more build of this tool, which replaces it
	 * when accepted. Each such result is returned and kept as `open` while that build remains,
	 * and as `closed` once it is spent, the attempt budget is spent, or the rebuild fails.
	 */
	readonly reopen?: {
		readonly misses: (result: Result) => boolean;
		readonly open: (result: Result) => Result;
		readonly closed: (result: Result) => Result;
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
					// The accepted result has this tool's result type when it is this tool's.
					const own =
						current.accepted?.operation === options.operation
							? (current.accepted.result as Result)
							: undefined;
					if (current.accepted && !(current.accepted.open && own)) {
						return own ?? options.rejected(turnAlreadyAcceptedIssue);
					}
					if (current.attempts >= turn.maxAttempts) {
						return own ?? options.rejected(attemptLimitIssue);
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
					const checked: Result =
						grounded.issues.length > 0
							? { ...built, issues: [...grounded.issues, ...built.issues] }
							: built;
					const { reopen } = options;
					if (checked.ok) {
						const misses = reopen?.misses(checked) === true;
						// Only a first acceptance with an attempt left reopens: the rebuild is the last.
						const open = misses && own === undefined && attempt < turn.maxAttempts;
						const result =
							!reopen || !misses ? checked : (open ? reopen.open : reopen.closed)(checked);
						yield* Ref.update(state, (value) => ({
							...value,
							accepted: { operation: options.operation, result, open },
						}));
						return result;
					}
					yield* Ref.update(state, (value) => ({ ...value, rejected: checked.issues }));
					if (own) {
						// A failed rebuild leaves the accepted artifact standing, and the turn closed.
						const closed = reopen && reopen.misses(own) ? reopen.closed(own) : own;
						yield* Ref.update(state, (value) => ({
							...value,
							accepted: { operation: options.operation, result: closed, open: false },
						}));
					}
					return checked;
				}),
			),
		);

		return {
			attempts: Ref.get(state).pipe(Effect.map((value) => value.attempts)),
			execute,
		};
	});
}
