import "@tanstack/react-start/server-only";

import {
	CodeModeIssueSchema,
	type ArtifactBundle,
	type PartialArtifactBundle,
	type BuildFlowchartResult,
	type BuildMindmapResult,
	type BuildSequenceDiagramResult,
	type BuildTimelineResult,
	type CreateCanvasResult,
} from "@sketchi/diagram-agent";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { withTelemetryCorrelation, type TelemetryCorrelationInput } from "@sketchi/observability";
import { Context, Deferred, Effect, Schema } from "effect";

import {
	PlaygroundBindings,
	PlaygroundClock,
	PlaygroundPlatformCallbacks,
	PlaygroundRequestMetadata,
} from "../runtime/context.server";
import {
	PlaygroundRequestCallbacks,
	type PlaygroundRequestRunner,
} from "../runtime/runtime.server";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { PlaygroundCodeMode } from "./service.server";
import {
	CodeModeDocsRequestSchema,
	CodeModeDocsResultSchema,
	CodeModeSearchRequestSchema,
	CodeModeSearchResultSchema,
	getCodeModeDocs,
	searchCodeModeDocs,
	SKETCHI_CODE_MODE_TYPES,
	SKETCHI_CODE_MODE_VERSION,
} from "./mcp-docs.server";
import { createEffectMcpServer, makeEffectMcpTool } from "./effect-mcp-adapter.server";
import { PlaygroundCodeModeUsage } from "./usage-events.server";

export interface SketchiCodeModeProvider {
	name: string;
	fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
	prelude?: string;
}

export interface SketchiCodeModeExecutor {
	execute(
		code: string,
		providers: SketchiCodeModeProvider[],
	): Promise<{
		result: unknown;
		error?: string;
		logs?: string[];
	}>;
}

export interface CodeModeMcpOptions {
	executor?: SketchiCodeModeExecutor;
}

interface MinimalExecutionContext {
	passThroughOnException(): void;
	props: Record<string, unknown>;
	waitUntil(promise: Promise<unknown>): void;
}

type McpHttpHandler = (
	request: Request,
	env: unknown,
	ctx: MinimalExecutionContext,
) => Promise<Response>;

const ExecuteRequestContract = Schema.Struct({
	code: Schema.String.check(
		Schema.isMinLength(1, {
			message: "Too small: expected string to have >=1 characters",
		}),
	),
});
export const ExecuteRequestSchema = toPlaygroundStandardSchema(ExecuteRequestContract);

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
});
const ExecuteBuildContract = Schema.Struct({
	index: Schema.Number,
	operation: Schema.Literals([
		"buildFlowchart",
		"buildMindmap",
		"buildSequenceDiagram",
		"buildTimeline",
		"createCanvas",
	]),
	ok: Schema.Boolean,
	status: Schema.String,
	buildId: Schema.optionalKey(Schema.String),
	requestId: Schema.optionalKey(Schema.String),
	normalizedSpec: Schema.optionalKey(Schema.Unknown),
	quality: Schema.optionalKey(Schema.Unknown),
	artifact: Schema.optionalKey(ExecuteBuildArtifactContract),
	partial: Schema.optionalKey(ExecuteBuildArtifactContract),
	issues: Schema.Array(CodeModeIssueSchema).pipe(Schema.mutable),
});
type ExecuteBuild = typeof ExecuteBuildContract.Type;
interface BuildObserver {
	started(
		index: number,
		operation: ExecuteBuild["operation"],
		completion: Effect.Effect<void>,
	): void;
	completed(build: ExecuteBuild): void;
}
type BuildOperation = ExecuteBuild["operation"];
type BuildResult =
	| BuildFlowchartResult
	| BuildMindmapResult
	| BuildSequenceDiagramResult
	| BuildTimelineResult
	| CreateCanvasResult;

// Receipts carry references, not a second copy of the potentially large inline scene/export.
function buildArtifactReference(artifact: ArtifactBundle | PartialArtifactBundle) {
	return {
		...(artifact.artifactId ? { artifactId: artifact.artifactId } : {}),
		...(artifact.diagramId ? { diagramId: artifact.diagramId } : {}),
		formats: artifactFormatsFrom(artifact.formats),
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
		issues,
	});
}

const ExecuteResultContract = Schema.Struct({
	builds: Schema.Array(ExecuteBuildContract).pipe(Schema.mutable),
	artifactDelivery: Schema.optionalKey(ExecuteArtifactDeliveryContract),
	finalResponseText: Schema.optionalKey(Schema.String),
	ok: Schema.Boolean,
	result: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.String),
	logs: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
});
export const ExecuteResultSchema = toPlaygroundStandardSchema(ExecuteResultContract);

type ArtifactDelivery = typeof ExecuteArtifactDeliveryContract.Type;
type ArtifactDeliveryFormat = ArtifactDelivery["formats"][number];

export type SketchiCodeModeExecuteOutput = typeof ExecuteResultContract.Type &
	Record<string, unknown>;

function stripCodeFence(code: string): string {
	const match = code.match(/^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/);
	return match?.[1] ?? code;
}

export function normalizeSketchiExecuteCode(code: string): string {
	return stripCodeFence(code.trim())
		.trim()
		.replace(/;+\s*$/, "");
}

/** Wait in the sandbox too: an unawaited RPC may not have reached the host yet. */
function trackSandboxBuilds(code: string): string {
	return `async () => {
      const pendingBuilds = [];
      const trackedSketchi = new Proxy(sketchi, {
        get(target, name) {
          const method = target[name];
          if (!["buildFlowchart", "buildMindmap", "buildSequenceDiagram", "buildTimeline", "createCanvas"].includes(name)) return method;
          return (...args) => {
            const pending = method(...args);
            pendingBuilds.push(pending);
            return pending;
          };
        }
      });
      try {
        return await ((sketchi) => (
${code}
        )())(trackedSketchi);
      } finally {
        for (let index = 0; index < pendingBuilds.length;) {
          const batch = pendingBuilds.slice(index);
          index = pendingBuilds.length;
          await Promise.allSettled(batch);
        }
      }
    }`;
}

function finalResponseTextFromResult(value: Record<string, unknown>) {
	return (
		stringValue(value.finalResponseText) ??
		(isRecord(value.artifactDelivery)
			? stringValue(value.artifactDelivery.finalResponseText)
			: undefined)
	);
}

function jsonResult(
	value: Record<string, unknown>,
	options: { includeFinalResponseText?: boolean } = {},
) {
	const finalResponseText = options.includeFinalResponseText
		? finalResponseTextFromResult(value)
		: undefined;
	return {
		content: [
			...(finalResponseText
				? [
						{
							type: "text" as const,
							text: finalResponseText,
						},
					]
				: []),
			{
				type: "text" as const,
				text: JSON.stringify(value, null, 2),
			},
		],
		structuredContent: value,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function artifactFormatsFrom(value: unknown): ArtifactDeliveryFormat[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(isRecord).flatMap((formatRef) => {
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

function acceptedArtifactContainerFrom(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	if (value.ok === true && isRecord(value.artifact)) {
		return value.artifact;
	}

	if (value.ok === true && stringValue(value.artifactId) && Array.isArray(value.formats)) {
		return value;
	}

	return (
		acceptedArtifactContainerFrom(value.result) ??
		acceptedArtifactContainerFrom(value.patched) ??
		acceptedArtifactContainerFrom(value.built) ??
		acceptedArtifactContainerFrom(value.artifact)
	);
}

function urlForFormat(
	formats: readonly ArtifactDeliveryFormat[],
	format: string,
): string | undefined {
	return formats.find((formatRef) => formatRef.format === format)?.url;
}

function fallbackArtifactUrl(
	origin: string,
	input: { artifactId: string; format: string },
): string {
	const url = new URL(`/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`, origin);
	url.searchParams.set("format", input.format);
	url.searchParams.set("raw", "true");
	return url.toString();
}

function artifactDeliveryResponseText(input: {
	artifactId: string;
	diagramId?: string;
	excalidrawUrl?: string;
	formats: readonly ArtifactDeliveryFormat[];
	pngUrl?: string;
}): string {
	return [
		"Sketchi artifact ready.",
		`Artifact ID: ${input.artifactId}`,
		...(input.diagramId ? [`Diagram ID: ${input.diagramId}`] : []),
		`Formats: ${input.formats.map((formatRef) => formatRef.format).join(", ")}`,
		...(input.excalidrawUrl ? [`Excalidraw URL: ${input.excalidrawUrl}`] : []),
		...(input.pngUrl ? [`PNG URL: ${input.pngUrl}`] : []),
	].join("\n");
}

function artifactDeliveryFrom(
	value: unknown,
	options: { origin?: string } = {},
): ArtifactDelivery | undefined {
	const artifact = acceptedArtifactContainerFrom(value);
	const artifactId = stringValue(artifact?.artifactId);
	if (!artifact || !artifactId) {
		return undefined;
	}

	const formats = artifactFormatsFrom(artifact.formats);
	if (formats.length === 0) {
		return undefined;
	}
	const formatsWithUrls = formats.map((formatRef) => ({
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

const CodeModeExecutionStageSchema = Schema.Literals(["configuration", "execute", "input"]);

export class CodeModeExecutionError extends Schema.TaggedError<CodeModeExecutionError>()(
	"CodeModeExecutionError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		stage: CodeModeExecutionStageSchema,
	},
) {}

function createDefaultCodeModeExecutor() {
	return Effect.gen(function* () {
		const env = yield* PlaygroundBindings;
		if (!env.LOADER) {
			return yield* Effect.fail(
				CodeModeExecutionError.make({
					cause: new Error("Code Mode Worker Loader binding is unavailable."),
					message: "Code Mode Worker Loader binding is not configured (env.LOADER).",
					stage: "configuration",
				}),
			);
		}

		return yield* Effect.tryPromise({
			try: async () => {
				const { DynamicWorkerExecutor } = (await import("@cloudflare/codemode")) as unknown as {
					DynamicWorkerExecutor: new (options: {
						loader: unknown;
						timeout?: number;
						globalOutbound?: unknown;
					}) => SketchiCodeModeExecutor;
				};
				return new DynamicWorkerExecutor({
					loader: env.LOADER,
					globalOutbound: null,
					timeout: 30_000,
				});
			},
			catch: (cause) =>
				CodeModeExecutionError.make({
					cause,
					message:
						cause instanceof Error ? cause.message : "Code Mode executor configuration failed.",
					stage: "configuration",
				}),
		});
	});
}

export const executeSketchiCodeMode = Effect.fn("playground.mcp.executeCodeMode")(function* (
	input: unknown,
	runToolEffect: PlaygroundRequestRunner,
	options: CodeModeMcpOptions = {},
) {
	const clock = yield* PlaygroundClock;
	const codeMode = yield* PlaygroundCodeMode;
	const metadata = yield* PlaygroundRequestMetadata;
	const usage = yield* PlaygroundCodeModeUsage;
	const usageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;
	const builds: ExecuteBuild[] = [];
	const pendingBuilds: Effect.Effect<void>[] = [];

	const executed: SketchiCodeModeExecuteOutput = yield* Effect.gen(function* () {
		const parsed = yield* Effect.try({
			try: () => Schema.decodeUnknownSync(ExecuteRequestContract)(input),
			catch: (cause) =>
				CodeModeExecutionError.make({
					cause,
					message: cause instanceof Error ? cause.message : String(cause),
					stage: "input",
				}),
		});
		const executor = options.executor ?? (yield* createDefaultCodeModeExecutor());
		const execution = yield* Effect.tryPromise({
			try: () =>
				executor.execute(trackSandboxBuilds(normalizeSketchiExecuteCode(parsed.code)), [
					makeSketchiCodeModeProvider(
						codeMode,
						runToolEffect,
						{
							attemptId: usageContext.attemptId,
							runId: usageContext.runId,
						},
						{
							started: (index, operation, completion) => {
								builds[index] = { index, operation, ok: false, status: "incomplete", issues: [] };
								pendingBuilds.push(completion);
							},
							completed: (build) => {
								builds[build.index] = build;
							},
						},
					),
				]),
			catch: (cause) =>
				CodeModeExecutionError.make({
					cause,
					message: cause instanceof Error ? cause.message : String(cause),
					stage: "execute",
				}),
		});
		const artifactDelivery = artifactDeliveryFrom(execution.result, {
			origin: metadata.origin,
		});

		if (execution.error) {
			return {
				...(artifactDelivery ? { artifactDelivery } : {}),
				...(artifactDelivery ? { finalResponseText: artifactDelivery.finalResponseText } : {}),
				ok: false,
				error: execution.error,
				logs: execution.logs ?? [],
				result: execution.result,
			};
		}

		return {
			...(artifactDelivery ? { artifactDelivery } : {}),
			...(artifactDelivery ? { finalResponseText: artifactDelivery.finalResponseText } : {}),
			ok: true,
			result: execution.result,
			logs: execution.logs ?? [],
		};
	}).pipe(
		Effect.catchTag("CodeModeExecutionError", (error) =>
			Effect.succeed({
				ok: false as const,
				error: error.message,
				logs: [] as string[],
			}),
		),
		// Do not turn executor timeouts/aborts into an unbounded wait for stalled host work.
		// Started but unfinished attempts remain visible as incomplete receipts.
		Effect.tap((output) =>
			output.ok
				? Effect.forEach(pendingBuilds, (completion) => completion, { discard: true })
				: Effect.void,
		),
		Effect.map((output) => ({ ...output, builds: [...builds].sort((a, b) => a.index - b.index) })),
		(executionEffect) =>
			withTelemetryCorrelation(executionEffect, {
				attemptId: usageContext.attemptId,
				runId: usageContext.runId,
			}),
	);
	const finishedAt = yield* clock.nowMillis;
	yield* usage.capture({
		context: usageContext,
		durationMs: finishedAt - startedAt,
		operation: "execute",
		requestBody: input,
		responseBody: executed,
		surface: "mcp",
	});
	return executed;
});

function withTrailingOptions(request: unknown, options: unknown): unknown {
	if (!isRecord(request) || !isRecord(options)) return request;
	const prototype = Object.getPrototypeOf(options);
	if (prototype !== Object.prototype && prototype !== null) return request;
	// Leave malformed documented options for the request validator to reject.
	if (request.options !== undefined && !isRecord(request.options)) return request;
	return { ...request, options: { ...options, ...request.options } };
}

export function makeSketchiCodeModeProvider(
	codeMode: Context.Service.Shape<typeof PlaygroundCodeMode>,
	runToolEffect: PlaygroundRequestRunner,
	correlation: TelemetryCorrelationInput = {},
	observer?: BuildObserver,
): SketchiCodeModeProvider {
	let nextBuildIndex = 0;
	// Keep receipt capture inside the existing request callback span.
	const build = Effect.fnUntraced(function* (operation: BuildOperation, request: unknown) {
		const index = nextBuildIndex++;
		const settled = yield* Deferred.make<void>();
		observer?.started(index, operation, Deferred.await(settled));
		return yield* Effect.gen(function* () {
			const result = yield* codeMode[operation](request);
			observer?.completed(buildReceipt(operation, index, result));
			return result;
		}).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)));
	});
	return {
		name: "sketchi",
		fns: {
			buildFlowchart: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						build("buildFlowchart", withTrailingOptions(request, options)),
						correlation,
					),
				),
			buildMindmap: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						build("buildMindmap", withTrailingOptions(request, options)),
						correlation,
					),
				),
			buildSequenceDiagram: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						build("buildSequenceDiagram", withTrailingOptions(request, options)),
						correlation,
					),
				),
			buildTimeline: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						build("buildTimeline", withTrailingOptions(request, options)),
						correlation,
					),
				),
			createCanvas: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						build("createCanvas", withTrailingOptions(request, options)),
						correlation,
					),
				),
			getArtifact: (request) =>
				runToolEffect(withTelemetryCorrelation(codeMode.getArtifact(request), correlation)),
			applyDiagramPatch: (request, options) =>
				runToolEffect(
					withTelemetryCorrelation(
						codeMode.applyDiagramPatch(withTrailingOptions(request, options)),
						correlation,
					),
				),
			searchIcons: (request) =>
				runToolEffect(withTelemetryCorrelation(codeMode.searchIcons(request), correlation)),
		},
	};
}

const docs = makeEffectMcpTool("docs", {
	title: "Sketchi Code Mode docs",
	description: "Read the harness-first Sketchi Code Mode MCP contract and usage guidance.",
	inputSchema: CodeModeDocsRequestSchema,
	outputSchema: CodeModeDocsResultSchema,
	annotations: {
		readOnlyHint: true,
		idempotentHint: true,
	},
}).bind((input) => jsonResult(getCodeModeDocs(input)));

const search = makeEffectMcpTool("search", {
	title: "Search Sketchi Code Mode docs",
	description:
		"Search Sketchi Code Mode operations, schemas, examples, non-goals, and repair hints.",
	inputSchema: CodeModeSearchRequestSchema,
	outputSchema: CodeModeSearchResultSchema,
	annotations: {
		readOnlyHint: true,
		idempotentHint: true,
	},
}).bind((input) => jsonResult(searchCodeModeDocs(input)));

const executeDefinition = makeEffectMcpTool("execute", {
	title: "Execute Sketchi Code Mode",
	description: [
		"Run an async JavaScript arrow function for an external agent harness.",
		"Write JavaScript only: no TypeScript syntax, annotations, interfaces, generics, imports, or named wrapper functions.",
		"Use the canonical shape: async () => { const result = await sketchi.buildFlowchart(...); return result; }",
		"Code fences and trailing expression semicolons are normalized before execution.",
		"The sandbox exposes sketchi.createCanvas, sketchi.buildFlowchart, sketchi.buildMindmap, sketchi.buildSequenceDiagram, sketchi.buildTimeline, sketchi.getArtifact, sketchi.applyDiagramPatch, and sketchi.searchIcons.",
		"For flowcharts, keep every requested step and decision in a separate node, preserving the prompt's step wording and order. Do not merge steps into compound labels.",
		"When the prompt names technologies, call sketchi.searchIcons({ q }) for each and set node.icon or sequence participant.icon to { slug } using a matching returned slug. One icon per node: give 'X on Y' separate technology steps. Labels alone do not add logos; check coverage.",
		"First get the semantic graph accepted, then use patch operations for deterministic visual changes.",
		"For final user-facing output, return accepted Sketchi artifact ids, format refs, and Excalidraw/PNG URLs. Do not recreate accepted diagrams as Markdown or Mermaid artifacts.",
		"When artifactDelivery is available, the first text content block is the final user-facing answer; copy it verbatim and stop.",
		"structuredContent.builds records every semantic or canvas build attempt in call order, independently of the script return value in result, without duplicating inline exports.",
		"When execute returns artifactDelivery, paste artifactDelivery.finalResponseText as the final chat response and stop.",
		"Do not call write_to_file/Create, create an Antigravity artifact, or inspect nested inline JSON after artifactDelivery is present.",
		"",
		SKETCHI_CODE_MODE_TYPES,
	].join("\n"),
	inputSchema: ExecuteRequestSchema,
	outputSchema: ExecuteResultSchema,
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
});

export function createSketchiMcpServer(
	runToolEffect: PlaygroundRequestRunner,
	options: CodeModeMcpOptions = {},
): Server {
	const execute = executeDefinition.bind((input) =>
		runToolEffect(executeSketchiCodeMode(input, runToolEffect, options)).then((result) =>
			jsonResult(result, {
				includeFinalResponseText: true,
			}),
		),
	);

	return createEffectMcpServer({
		name: "sketchi-code-mode",
		tools: [docs, search, execute],
		version: SKETCHI_CODE_MODE_VERSION,
	});
}

function createExecutionContext(
	platform: Context.Service.Shape<typeof PlaygroundPlatformCallbacks>,
): MinimalExecutionContext {
	return {
		passThroughOnException() {},
		props: {},
		waitUntil: platform.waitUntilPromise,
	};
}

export class McpTransportError extends Schema.TaggedError<McpTransportError>()(
	"McpTransportError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
	},
) {}

export const handleSketchiMcpRequest = Effect.fn("playground.http.mcp")(function* (
	request: Request,
	options: CodeModeMcpOptions = {},
) {
	const callbacks = yield* PlaygroundRequestCallbacks;
	const env = yield* PlaygroundBindings;
	const platform = yield* PlaygroundPlatformCallbacks;
	const createMcpHandler = yield* Effect.tryPromise({
		try: () => import("agents/mcp").then((module) => module.createMcpHandler),
		catch: (cause) =>
			McpTransportError.make({
				cause,
				message: cause instanceof Error ? cause.message : "MCP transport failed.",
			}),
	});
	const handler: McpHttpHandler = createMcpHandler(
		createSketchiMcpServer(callbacks.runPromise, options),
		{ route: "/mcp" },
	);

	return yield* Effect.tryPromise({
		try: (signal) =>
			handler(
				new Request(request, {
					signal: AbortSignal.any([signal, request.signal]),
				}),
				env,
				createExecutionContext(platform),
			),
		catch: (cause) =>
			McpTransportError.make({
				cause,
				message: cause instanceof Error ? cause.message : "MCP transport failed.",
			}),
	});
});
