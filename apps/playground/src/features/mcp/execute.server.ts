import {
	Array as Arr,
	Option as Opt,
	Record as Rec,
	Equal,
	Clock,
	Effect,
	FiberSet,
	Ref,
	Schema,
} from "effect";
import {
	families,
	FAMILY_BUILD_OPERATIONS,
	type FamilyBuildResult,
	type FamilyOperation,
} from "@sketchi/diagrams/family";
import "@tanstack/react-start/server-only";
import {
	type ApplyDiagramPatchResult,
	type CreateCanvasResult,
	type EditFlowchartResult,
} from "@sketchi/diagrams/build/code-mode/contract";
import { CodeModeIssue } from "@sketchi/diagrams/build/result";
import { type ArtifactBundle, type PartialArtifactBundle } from "@sketchi/drawing/artifacts";
import { normalizeCode } from "@cloudflare/codemode";
import { CodeModeArtifactStorage } from "@sketchi/diagrams/build/code-mode/artifacts";
import * as Build from "@sketchi/diagrams/build/code-mode/runtime";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import { CodeModeSandbox, CodeModeExecutionError, type SandboxFunctions } from "./sandbox.server";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { drawIconForAgent } from "../../server/icons/draw.server";
import {
	PlaygroundBindings,
	PlaygroundClock,
	PlaygroundRequestMetadata,
} from "../../server/runtime/context.server";
import { PNG_EXPORT_TIMEOUT_MS } from "../render/browser-render-pool.server";
import { SKETCHI_EXECUTE_CODE_DESCRIPTION } from "./mcp-docs.server";
import { PlaygroundCodeModeUsage } from "../build/usage-events.server";
/**
 * A script's default PNGs share this budget, so execute stays responsive; an explicit
 * "png" in artifactFormats waits for the renderer's own PNG_EXPORT_TIMEOUT_MS instead.
 */
const DEFAULT_PNG_BUDGET_MS = 15000;
const DEFAULT_PNG_UNAVAILABLE_HINT = `Scene and Excalidraw are available. For the PNG, call again with options.artifactFormats ["scene", "excalidraw", "png"], which gives the export ${PNG_EXPORT_TIMEOUT_MS / 1000} seconds.`;
const ExecuteRequestContract = Schema.Struct({
	code: Schema.NonEmptyString.annotate({ description: SKETCHI_EXECUTE_CODE_DESCRIPTION }),
});
export const ExecuteRequestSchema = ExecuteRequestContract;
const ExecuteArtifactDeliveryContract = Schema.Struct({
	artifactId: Schema.String,
	diagramId: Schema.optionalKey(Schema.String),
	excalidrawUrl: Schema.optionalKey(Schema.String),
	finalResponseInstruction: Schema.String,
	finalResponseText: Schema.String,
	formats: Schema.Array(
		Schema.Struct({
			expiresAt: Schema.optionalKey(Schema.String),
			format: Schema.String,
			mimeType: Schema.optionalKey(Schema.String),
			sizeBytes: Schema.optionalKey(Schema.Finite),
			url: Schema.optionalKey(Schema.String),
		}),
	).pipe(Schema.mutable),
	pngUrl: Schema.optionalKey(Schema.String),
	sceneUrl: Schema.optionalKey(Schema.String),
});
const ExecuteBuildArtifactContract = Schema.Struct({
	artifactId: Schema.optionalKey(Schema.String),
	diagramId: Schema.optionalKey(Schema.String),
	formats: ExecuteArtifactDeliveryContract.fields.formats,
	/** The artifact an edit started from. */
	provenance: Schema.optionalKey(Schema.Struct({ sourceArtifactId: Schema.String })),
});
const BUILD_OPERATIONS = [
	...FAMILY_BUILD_OPERATIONS.slice(0, 1),
	"editFlowchart",
	...FAMILY_BUILD_OPERATIONS.slice(1),
	"createCanvas",
] as const;
const ExecuteBuildContract = Schema.Struct({
	index: Schema.Number,
	operation: Schema.Literals(BUILD_OPERATIONS),
	ok: Schema.Boolean,
	status: Schema.String,
	buildId: Schema.optionalKey(Schema.String),
	requestId: Schema.optionalKey(Schema.String),
	normalizedSpec: Schema.optionalKey(Schema.Unknown),
	quality: Schema.optionalKey(Schema.Unknown),
	artifact: Schema.optionalKey(ExecuteBuildArtifactContract),
	partial: Schema.optionalKey(ExecuteBuildArtifactContract),
	/** The edits an editFlowchart applied. */
	edits: Schema.optionalKey(Schema.Unknown),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
});
type ExecuteBuild = typeof ExecuteBuildContract.Type;
type BuildOperation = ExecuteBuild["operation"];
type BuildResult = FamilyBuildResult | EditFlowchartResult | CreateCanvasResult;
// Receipts carry references, not a second copy of the potentially large inline scene/export.
function buildArtifactReference(artifact: ArtifactBundle | PartialArtifactBundle) {
	return {
		...(artifact.artifactId ? { artifactId: artifact.artifactId } : {}),
		...(artifact.diagramId ? { diagramId: artifact.diagramId } : {}),
		formats: artifactFormatsFrom(artifact.formats),
		...("provenance" in artifact && artifact.provenance
			? { provenance: { sourceArtifactId: artifact.provenance.sourceArtifactId } }
			: {}),
	};
}
function buildReceipt(operation: BuildOperation, index: number, result: BuildResult): ExecuteBuild {
	const { ok, status, buildId, requestId, normalizedSpec, issues } = result;
	// Copy before handing the result to script code, which may mutate it.
	return structuredClone({
		index,
		operation,
		ok,
		status,
		...(buildId === undefined ? {} : { buildId }),
		...(requestId === undefined ? {} : { requestId }),
		...(normalizedSpec === undefined ? {} : { normalizedSpec }),
		...("quality" in result && result.quality ? { quality: result.quality } : {}),
		...(result.ok
			? { artifact: buildArtifactReference(result.artifact) }
			: result.partial
				? { partial: buildArtifactReference(result.partial) }
				: {}),
		// An edit's result carries what it applied; the receipt matches it, so execute compacts it.
		...("edits" in result && result.edits ? { edits: result.edits } : {}),
		issues,
	});
}
// Match the entire returned value, not just its ID: scripts may edit or extend a build.
// Comparing against the reference-only receipt also preserves explicitly requested inline exports.
function compactBuildResult(value: unknown, builds: readonly ExecuteBuild[]): unknown {
	if (!isRecord(value) || builds.length === 0) return value;
	const returned = structuredClone(value);
	for (const build of builds) {
		const { index: _index, operation: _operation, ...receipt } = build;
		// Pre-ID failures stay full so readers retain their diagnostics and provenance.
		if (!build.buildId) continue;
		if (!Equal.equals(returned, receipt)) continue;
		const png = Opt.getOrUndefined(
			Arr.findFirst(build.artifact?.formats ?? [], (format) => format.format === "png"),
		)?.url;
		return {
			buildId: build.buildId,
			ok: build.ok,
			...(build.artifact?.artifactId ? { artifactId: build.artifact.artifactId } : {}),
			...(png ? { png } : {}),
		};
	}
	return value;
}
/**
 * A flowchart built from a request it misses in part is still delivered, but the caller first
 * gets one chance to fix it with an edit. An edit's own misses do not hold delivery again.
 */
function coverageNotice(
	delivery: ArtifactDelivery | undefined,
	builds: readonly (ExecuteBuild | undefined)[],
): string | undefined {
	const delivered = Opt.getOrUndefined(
		Arr.findFirst(
			builds,
			(build) =>
				build?.operation === "buildFlowchart" &&
				build.ok &&
				delivery !== undefined &&
				build.artifact?.artifactId === delivery.artifactId,
		),
	);
	const missing = Arr.filter(delivered?.issues ?? [], (issue) => issue.stage === "coverage");
	if (!delivery || missing.length === 0) return undefined;
	return Arr.join(
		[
			`Before you answer, fix what the request states that this flowchart misses with sketchi.editFlowchart({ artifactId: "${delivery.artifactId}", edits }), then answer with that result:`,
			...Arr.map(missing, (issue) => `- ${issue.message}`),
		],
		"\n",
	);
}
const COVERAGE_DELIVERY_INSTRUCTION =
	"Fix the coverage issues with editFlowchart first, then paste that result's artifactDelivery.finalResponseText as the final chat response and stop.";
const ExecuteResultContract = Schema.Struct({
	builds: Schema.Array(ExecuteBuildContract).pipe(Schema.mutable),
	artifactDelivery: Schema.optionalKey(ExecuteArtifactDeliveryContract),
	finalResponseText: Schema.optionalKey(Schema.String),
	/** What an accepted flowchart misses of the request it was given, to fix before answering. */
	coverageNotice: Schema.optionalKey(Schema.String),
	ok: Schema.Boolean,
	result: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.String),
	logs: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
});
export const ExecuteResultSchema = ExecuteResultContract;
type ArtifactDelivery = typeof ExecuteArtifactDeliveryContract.Type;
type ArtifactDeliveryFormat = ArtifactDelivery["formats"][number];
export type SketchiCodeModeExecuteOutput = typeof ExecuteResultContract.Type &
	Record<string, unknown>;
/** Wait in the sandbox too: an unawaited RPC may not have reached the host yet. */
function trackSandboxBuilds(code: string, operationNames: string): string {
	return `async () => {
      const pendingBuilds = [];
      const trackedSketchi = new Proxy(sketchi, {
        get(target, name) {
          const method = target[name];
          if (!${operationNames}.includes(name)) return method;
          return (...args) => {
            const pending = method(...args);
            pendingBuilds.push(pending);
            return pending;
          };
        }
      });
      try {
        return await ((sketchi) => {
          const script = ${code};
          return script();
        })(trackedSketchi);
      } finally {
        for (let index = 0; index < pendingBuilds.length;) {
          const batch = pendingBuilds.slice(index);
          index = pendingBuilds.length;
          await Promise.allSettled(batch);
        }
      }
    }`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Arr.isArray(value);
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function artifactFormatsFrom(value: unknown): ArtifactDeliveryFormat[] {
	if (!Arr.isArray(value)) {
		return [];
	}
	return Arr.flatMap(value, (formatRef) => {
		if (!isRecord(formatRef)) return [];
		const format = stringValue(formatRef.format);
		if (!format) {
			return [];
		}
		const expiresAt = stringValue(formatRef.expiresAt);
		const mimeType = stringValue(formatRef.mimeType);
		const sizeBytes = numberValue(formatRef.sizeBytes);
		const url = stringValue(formatRef.url);
		return [
			{
				...(expiresAt ? { expiresAt } : {}),
				format,
				...(mimeType ? { mimeType } : {}),
				...(sizeBytes === undefined ? {} : { sizeBytes }),
				...(url ? { url } : {}),
			},
		];
	});
}
function acceptedArtifactResultFrom(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.ok === true && isRecord(value.artifact)) {
		return value;
	}
	if (value.ok === true && stringValue(value.artifactId) && Arr.isArray(value.formats)) {
		return value;
	}
	return (
		acceptedArtifactResultFrom(value.result) ??
		acceptedArtifactResultFrom(value.patched) ??
		acceptedArtifactResultFrom(value.built) ??
		acceptedArtifactResultFrom(value.artifact)
	);
}
function urlForFormat(
	formats: readonly ArtifactDeliveryFormat[],
	format: string,
): string | undefined {
	return Opt.getOrUndefined(Arr.findFirst(formats, (formatRef) => formatRef.format === format))
		?.url;
}
function fallbackArtifactUrl(
	origin: string,
	input: {
		artifactId: string;
		format: string;
	},
): string {
	const url = new URL(`/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`, origin);
	url.searchParams.set("format", input.format);
	url.searchParams.set("raw", "true");
	return url.toString();
}
function returnedPngFailureText(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (value.ok === false && value.status === "export_failed" && Arr.isArray(value.issues)) {
		const failure = Opt.getOrUndefined(
			Arr.findFirst(
				value.issues,
				(issue) => isRecord(issue) && issue.code === "render_failed" && issue.stage === "export",
			),
		);
		if (isRecord(failure))
			return `PNG unavailable: ${stringValue(failure.message) ?? "Rendering failed."} ${stringValue(failure.hint) ?? "Retry the request."}`;
	}
	return (
		returnedPngFailureText(value.result) ??
		returnedPngFailureText(value.patched) ??
		returnedPngFailureText(value.built)
	);
}
function artifactDeliveryResponseText(input: {
	artifactId: string;
	diagramId?: string;
	excalidrawUrl?: string;
	formats: readonly ArtifactDeliveryFormat[];
	pngUrl?: string;
}): string {
	return Arr.join(
		[
			"Sketchi artifact ready.",
			`Artifact ID: ${input.artifactId}`,
			...(input.diagramId ? [`Diagram ID: ${input.diagramId}`] : []),
			`Formats: ${Arr.join(
				Arr.map(input.formats, (formatRef) => formatRef.format),
				", ",
			)}`,
			...(input.excalidrawUrl ? [`Excalidraw URL: ${input.excalidrawUrl}`] : []),
			...(input.pngUrl ? [`PNG URL: ${input.pngUrl}`] : []),
		],
		"\n",
	);
}
function artifactDeliveryFrom(
	value: unknown,
	options: {
		origin?: string;
	} = {},
): ArtifactDelivery | undefined {
	const accepted = acceptedArtifactResultFrom(value);
	const artifact = isRecord(accepted?.artifact) ? accepted.artifact : accepted;
	const artifactId = stringValue(artifact?.artifactId);
	if (!artifact || !artifactId) {
		return undefined;
	}
	const formats = artifactFormatsFrom(artifact.formats);
	if (formats.length === 0) {
		return undefined;
	}
	const formatsWithUrls = Arr.map(formats, (formatRef) => ({
		...formatRef,
		...(formatRef.url || !options.origin
			? {}
			: {
					url: fallbackArtifactUrl(options.origin, {
						artifactId,
						format: formatRef.format,
					}),
				}),
	}));
	const diagramId = stringValue(artifact.diagramId);
	const excalidrawUrl = urlForFormat(formatsWithUrls, "excalidraw");
	const pngUrl = urlForFormat(formatsWithUrls, "png");
	const sceneUrl = urlForFormat(formatsWithUrls, "scene");
	const finalResponseText = artifactDeliveryResponseText({
		artifactId,
		...(diagramId ? { diagramId } : {}),
		...(excalidrawUrl ? { excalidrawUrl } : {}),
		formats: formatsWithUrls,
		...(pngUrl ? { pngUrl } : {}),
	});
	return {
		artifactId,
		...(diagramId ? { diagramId } : {}),
		...(excalidrawUrl ? { excalidrawUrl } : {}),
		finalResponseInstruction:
			"Paste artifactDelivery.finalResponseText as the final chat response and stop. Do not inspect nested inline JSON, call write_to_file/Create, create a Markdown wrapper, create a Mermaid diagram, create a local file, or create a separate Antigravity artifact after Sketchi accepts the diagram.",
		finalResponseText,
		formats: formatsWithUrls,
		...(pngUrl ? { pngUrl } : {}),
		...(sceneUrl ? { sceneUrl } : {}),
	};
}
/** Toolkit decodes once; execute owns its sandbox and every host callback fiber. */
export const executeSketchiCodeMode = Effect.fn("studio.mcp.execute")(function* (
	input: typeof ExecuteRequestSchema.Type,
) {
	const clock = yield* PlaygroundClock;
	const metadata = yield* PlaygroundRequestMetadata;
	const usage = yield* PlaygroundCodeModeUsage;
	const sandbox = yield* CodeModeSandbox;
	const usageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;
	const builds = yield* Ref.make<readonly ExecuteBuild[]>([]);
	const deadline = (yield* Clock.currentTimeMillis) + DEFAULT_PNG_BUDGET_MS;
	const executed = yield* Effect.scoped(
		Effect.gen(function* () {
			const fibers = yield* FiberSet.make();
			const functions = yield* makeSketchiFunctions(builds, fibers, deadline);
			const operationNames = yield* Schema.encodeEffect(
				Schema.fromJsonString(Schema.Array(Schema.String)),
			)(BUILD_OPERATIONS).pipe(Effect.orDie);
			const code = yield* Effect.try({
				try: () => trackSandboxBuilds(normalizeCode(input.code), operationNames),
				catch: (cause) =>
					new CodeModeExecutionError({
						cause,
						message: cause instanceof Error ? cause.message : "Invalid script.",
						stage: "execute",
					}),
			});
			const execution = yield* sandbox.execute(code, functions);
			// The sandbox drains its RPC calls too: awaitEmpty alone cannot see an RPC that
			// has not reached this host. Error/timeout/cancellation closes this scope instead.
			if (!execution.error) yield* FiberSet.awaitEmpty(fibers);
			const receipts = yield* Ref.get(builds);
			const delivery = artifactDeliveryFrom(execution.result, { origin: metadata.origin });
			const selected = Opt.getOrUndefined(
				Arr.findFirst(
					receipts,
					(build) => build.ok && build.artifact?.artifactId === delivery?.artifactId,
				),
			);
			const selectedIssues =
				selected?.issues ?? acceptedArtifactResultFrom(execution.result)?.issues;
			const pngNote = delivery
				? Arr.isArray(selectedIssues) &&
					Arr.some(selectedIssues, (issue) => isRecord(issue) && issue.code === "png_unavailable")
					? `PNG unavailable. ${DEFAULT_PNG_UNAVAILABLE_HINT}`
					: undefined
				: returnedPngFailureText(execution.result);
			const artifactDelivery =
				delivery && pngNote
					? { ...delivery, finalResponseText: `${delivery.finalResponseText}\n${pngNote}` }
					: delivery;
			const finalResponseText = artifactDelivery?.finalResponseText ?? pngNote;
			const notice = !execution.error ? coverageNotice(artifactDelivery, receipts) : undefined;
			return {
				...(artifactDelivery
					? {
							artifactDelivery: notice
								? { ...artifactDelivery, finalResponseInstruction: COVERAGE_DELIVERY_INSTRUCTION }
								: artifactDelivery,
						}
					: {}),
				...(notice ? { coverageNotice: notice } : finalResponseText ? { finalResponseText } : {}),
				ok: !execution.error,
				...(execution.error ? { error: execution.error } : {}),
				...(execution.result === undefined
					? {}
					: { result: compactBuildResult(execution.result, receipts) }),
				logs: execution.logs ?? [],
			};
		}),
	).pipe(
		Effect.catchTag("CodeModeExecutionError", (error) =>
			Effect.succeed({ ok: false, error: error.message, logs: [] }),
		),
		(effect) =>
			withTelemetryCorrelation(effect, {
				attemptId: usageContext.attemptId,
				runId: usageContext.runId,
			}),
	);
	// Closing the scope stops child work before taking this immutable final snapshot.
	const output: SketchiCodeModeExecuteOutput = {
		...executed,
		builds: structuredClone([...(yield* Ref.get(builds))]),
	};
	yield* usage.capture({
		context: usageContext,
		durationMs: (yield* clock.nowMillis) - startedAt,
		operation: "execute",
		requestBody: input,
		responseBody: output,
		surface: "mcp",
	});
	return output;
});
/**
 * Execute results go to a model, which reads artifact URLs and issues, not
 * exports: unlike the HTTP API, inline nothing and include PNG by default.
 * Builders reject invalid specs and quality/export validation failures before
 * rendering PNG. Explicit format lists still win, including an empty list.
 */
function withModelDelivery(request: unknown): unknown {
	if (!isRecord(request)) return request;
	if (request.options !== undefined && !isRecord(request.options)) return request;
	return {
		...request,
		options: {
			...request.options,
			...(request.options?.artifactFormats === undefined
				? { artifactFormats: ["scene", "excalidraw", "png"] }
				: {}),
			...(request.options?.inlineArtifacts === undefined ? { inlineArtifacts: [] } : {}),
		},
	};
}
type BuildServices = CodeModeArtifactStorage | Build.CodeModeRuntimeEnvironment;
const makeSketchiFunctions = Effect.fn("studio.mcp.functions")(function* (
	receipts: Ref.Ref<readonly ExecuteBuild[]>,
	fibers: FiberSet.FiberSet<unknown, unknown>,
	deadline: number,
) {
	const run = yield* FiberSet.runtimePromise(fibers)<
		BuildServices | PlaygroundBindings | PlaygroundRequestMetadata
	>();
	const deliver = Effect.fn("studio.mcp.deliver")(function* <
		A extends BuildResult | ApplyDiagramPatchResult,
	>(request: unknown, workflow: Effect.Effect<A, never, BuildServices>) {
		const defaulted =
			isRecord(request) &&
			(request.options === undefined ||
				(isRecord(request.options) && request.options.artifactFormats === undefined));
		// The existing diagrams capability accepts a synchronous report callback.
		// This single per-build value cannot escape its invocation or mutate a receipt.
		let unavailable: string | undefined;
		const result = yield* workflow.pipe(
			Effect.updateService(Build.CodeModeRuntimeEnvironment, (capabilities) => ({
				...capabilities,
				fillNamedLogos: true,
				...(defaulted
					? {
							defaultPng: {
								deadlineMillis: deadline,
								onUnavailable: (message: string) => {
									unavailable = message;
								},
							},
						}
					: {}),
			})),
		);
		if (result.ok)
			return unavailable === undefined
				? result
				: {
						...result,
						issues: [
							...result.issues,
							{
								code: "png_unavailable" as const,
								severity: "warning" as const,
								stage: "export" as const,
								message: `PNG unavailable: ${unavailable}`,
								hint: DEFAULT_PNG_UNAVAILABLE_HINT,
							},
						],
					};
		if (result.status !== "export_failed") return result;
		return {
			...result,
			issues: [
				...result.issues,
				...Arr.map(
					Arr.filter(
						result.issues,
						(issue) => issue.code === "render_failed" && issue.stage === "export",
					),
					(issue) => ({
						...issue,
						code: "png_unavailable" as const,
						severity: "warning" as const,
						message: `PNG unavailable: ${issue.message}`,
					}),
				),
			],
		};
	});
	const build = Effect.fn("studio.mcp.build")(function* (
		operation: BuildOperation,
		request: unknown,
		workflow: Effect.Effect<BuildResult, never, BuildServices>,
	) {
		const index = yield* Ref.modify(receipts, (current) => [
			current.length,
			[
				...current,
				{ index: current.length, operation, ok: false, status: "incomplete", issues: [] },
			],
		]);
		const result = yield* deliver(request, workflow);
		const receipt = buildReceipt(operation, index, result);
		yield* Ref.update(receipts, (current) =>
			Arr.map(current, (value) => (value.index === index ? receipt : value)),
		);
		return result;
	});
	return {
		...Rec.fromEntries(
			Arr.map(families, (family) => [
				family.operation,
				(input: unknown) => {
					const operation: FamilyOperation<FamilyBuildResult> = family;
					return run(
						build(
							family.operation,
							input,
							buildResponse(operation.build(Build)(withModelDelivery(input))),
						),
					);
				},
			]),
		),
		editFlowchart: (input) => {
			return run(
				build("editFlowchart", input, buildResponse(Build.editFlowchart(withModelDelivery(input)))),
			);
		},
		createCanvas: (input) => {
			return run(
				build("createCanvas", input, buildResponse(Build.createCanvas(withModelDelivery(input)))),
			);
		},
		getArtifact: (request) => run(buildResponse(Build.getArtifact(request))),
		applyDiagramPatch: (input) => {
			return run(deliver(input, buildResponse(Build.applyDiagramPatch(withModelDelivery(input)))));
		},
		searchIcons: (request) => run(buildResponse(Build.searchIcons(request))),
		drawIcon: (request) => run(drawIconForAgent(request)),
	} satisfies SandboxFunctions;
});
