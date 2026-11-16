import { canvasFailureStatus, canvasValidationIssues } from "./scene";
import { Array, Effect, Result, Schema, SchemaIssue } from "effect";
import {
	CanvasValidationIssue,
	getCanvasValidationIssues,
	type CanvasSpec,
} from "@sketchi/drawing";
import { ArtifactBundleSchema, PartialArtifactBundleSchema } from "@sketchi/drawing/artifacts";
import {
	BuildOptions,
	PublishedBuildIssue,
	CodeModeIssue,
	CodeModeIssueCodeSchema,
	QualityReportSchema,
	type ArtifactBuildCapabilities,
	type QualityReport,
	type CodeModeIssueCode,
	type DiagramCounts,
} from "./result";

/** Expected build errors retain their typed cause until a CLI, HTTP or tool host asks for a body. */
export interface BuildRejection<A> {
	readonly status: string;
	readonly toResult: () => A;
}
export interface BuildFailure<Reason, Context, Response> extends BuildRejection<Response> {
	readonly _tag: "BuildFailure";
	readonly reason: Reason;
	readonly context: Context;
}
export function buildResponse<A, E extends BuildRejection<unknown>, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | (E extends BuildRejection<infer B> ? B : never), never, R>;
export function buildResponse<A, B, R>(effect: Effect.Effect<A, BuildRejection<B>, R>) {
	return effect.pipe(Effect.catch((error) => Effect.succeed(error.toResult())));
}

/** One envelope and operation; families supply only their document and actual domain policy. */
export function defineBuild<
	D,
	N,
	E,
	const S extends string,
	T extends Schema.Top,
	R = never,
	C = N,
	P extends Schema.Codec<CodeModeIssue> = typeof PublishedBuildIssue,
	const Name extends string = string,
>(policy: {
	readonly name: Name;
	readonly document: Schema.Codec<D, unknown>;
	readonly normalized: Schema.Codec<N, unknown>;
	readonly tool: T;
	readonly error: Schema.Codec<E, unknown>;
	readonly issueCodes: Schema.Codec<string>;
	readonly publishedIssues: P;
	readonly invalidStatus: S;
	readonly documentStatus?: (error: E) => S | "limit_exceeded";
	readonly requestText?: Schema.Codec<string>;
	readonly prepare?: (input: unknown) => Result.Result<unknown, E>;
	readonly normalize: (document: D) => N | Result.Result<N, E>;
	readonly check: (document: N) => Result.Result<C, E>;
	readonly issues: (error: E) => CodeModeIssue[];
	readonly inputIssues?: (error: Schema.SchemaError) => CodeModeIssue[];
	readonly counts: (document: C) => DiagramCounts;
	readonly warnings?: (
		document: C,
		request: string | undefined,
		scene: CanvasSpec,
		authored: D,
	) => P["Type"][];
	readonly assess?: (document: C, threshold: number) => QualityReport;
	readonly assessScene?: (document: C, scene: CanvasSpec, quality: QualityReport) => QualityReport;
	readonly qualityIssue?: { readonly code: CodeModeIssueCode; readonly hint: string };
	readonly qualityIssues?: (quality: QualityReport) => CodeModeIssue[];
	readonly render: (document: C) => CanvasSpec | Result.Result<CanvasSpec, E>;
	readonly resolve?: (document: D) => Effect.Effect<
		{
			readonly document: N;
			/** A family that resolves icons while validating reuses that checked model. */
			readonly checked?: Result.Result<C, E>;
			/** The authored document retained for an actual edit operation. */
			readonly storedDocument?: unknown;
			readonly issues: P["Type"][];
			readonly render: (scene: CanvasSpec) => Effect.Effect<{
				readonly scene: CanvasSpec;
				readonly issues: P["Type"][];
			}>;
		},
		E,
		R
	>;
	readonly renderHint: string;
}) {
	const fields = {
		requestId: Schema.optionalKey(Schema.NonEmptyString),
		spec: policy.document,
		options: Schema.optionalKey(BuildOptions),
	};
	const Request = policy.requestText
		? Schema.Struct({ ...fields, request: Schema.optionalKey(policy.requestText) })
		: Schema.Struct(fields);
	const ToolInput = Schema.Struct({ requestId: Request.fields.requestId, spec: policy.tool });
	const Context = Schema.Struct({
		buildId: Schema.optionalKey(Schema.String),
		requestId: Schema.optionalKey(Schema.String),
		normalizedSpec: Schema.optionalKey(policy.normalized),
		quality: Schema.optionalKey(QualityReportSchema),
		partial: Schema.optionalKey(PartialArtifactBundleSchema),
	});
	const Status = Schema.Literals([
		"invalid_input",
		policy.invalidStatus,
		"quality_failed",
		"limit_exceeded",
		"render_failed",
		"export_failed",
		"storage_failed",
	]);
	const Rejected = Schema.Struct({
		ok: Schema.Literal(false),
		status: Status,
		...Context.fields,
		issues: Schema.Array(
			CodeModeIssue.mapFields((fields) => ({
				...fields,
				code: Schema.Union([CodeModeIssueCodeSchema, policy.issueCodes]),
			})),
		).pipe(Schema.mutable),
	});
	const Accepted = Schema.Struct({
		ok: Schema.Literal(true),
		status: Schema.Literal("accepted"),
		buildId: Schema.String,
		requestId: Request.fields.requestId,
		normalizedSpec: policy.normalized,
		quality: QualityReportSchema,
		artifact: ArtifactBundleSchema,
		issues: Schema.Array(policy.publishedIssues).pipe(Schema.mutable),
	});
	const Reason = Schema.TaggedUnion({
		Input: { error: Schema.declare(Schema.isSchemaError) },
		Document: { error: policy.error },
		Quality: { quality: QualityReportSchema },
		Render: { cause: Schema.Defect() },
		Scene: { issues: Schema.Array(CanvasValidationIssue) },
		Delivery: {
			status: Schema.Literals(["limit_exceeded", "export_failed", "storage_failed"]),
			issues: Rejected.fields.issues,
		},
	});
	class Failure extends Schema.TaggedError<Failure, { readonly brand: unique symbol }>()(
		"BuildFailure",
		{ reason: Reason, context: Context },
	) {
		get status() {
			switch (this.reason._tag) {
				case "Input":
					return "invalid_input" as const;
				case "Document":
					return policy.documentStatus?.(this.reason.error) ?? policy.invalidStatus;
				case "Quality":
					return "quality_failed" as const;
				case "Render":
					return "render_failed" as const;
				case "Scene":
					return canvasFailureStatus(this.reason.issues);
				case "Delivery":
					return this.reason.status;
			}
		}
		toResult(): typeof Rejected.Type {
			const reason = this.reason;
			let issues: CodeModeIssue[];
			switch (reason._tag) {
				case "Input":
					issues =
						policy.inputIssues?.(reason.error) ??
						Array.map(
							Array.take(
								SchemaIssue.makeFormatterStandardSchemaV1()(reason.error.issue).issues,
								20,
							),
							(entry) => ({
								code: "invalid_type",
								severity: "error",
								stage: "input",
								ref: {
									kind: "request",
									path:
										Array.join(
											Array.map(entry.path ?? [], (part) =>
												String(typeof part === "object" ? part.key : part),
											),
											".",
										) || "input",
								},
								message: entry.message,
								hint: `Repair the request using the ${policy.name} document schema.`,
							}),
						);
					break;
				case "Document":
					issues = policy.issues(reason.error);
					break;
				case "Quality":
					issues =
						policy.qualityIssues?.(reason.quality) ??
						Array.map(reason.quality.checks, (check) => ({
							code: policy.qualityIssue?.code ?? "quality_below_threshold",
							severity: check.severity,
							stage: "quality",
							message: check.message,
							hint:
								policy.qualityIssue?.hint ??
								"Revise the document to meet the requested quality threshold.",
							...(check.refs[0] ? { ref: check.refs[0] } : {}),
						}));
					break;
				case "Render":
					issues = [
						{
							code: "render_failed",
							severity: "error",
							stage: "render",
							message:
								reason.cause instanceof Error
									? reason.cause.message
									: `Unable to render ${policy.name} scene.`,
							hint: policy.renderHint,
						},
					];
					break;
				case "Scene":
					issues = Array.map(canvasValidationIssues(reason.issues), (issue) => ({
						...issue,
						hint: policy.renderHint,
					}));
					break;
				case "Delivery":
					issues = reason.issues;
					break;
			}
			return { ok: false, status: this.status, ...this.context, issues };
		}
	}
	function failure(input: {
		readonly reason: typeof Reason.Type;
		readonly context: typeof Context.Type;
	}): Failure {
		// Failure context contains the document that failed; validating its constraints again would turn a typed rejection into a defect.
		return new Failure(input, { disableChecks: true });
	}

	type FailureValue = BuildFailure<typeof Reason.Type, typeof Context.Type, typeof Rejected.Type>;
	const decode: (input: unknown) => Effect.Effect<typeof Request.Type, FailureValue> = Effect.fn(
		`${policy.name}.decodeRequest`,
	)(function* (input: unknown) {
		const prepared = policy.prepare
			? yield* Effect.fromResult(policy.prepare(input)).pipe(
					Effect.mapError((error) => failure({ reason: { _tag: "Document", error }, context: {} })),
				)
			: input;
		return yield* Schema.decodeUnknownEffect(Request, { errors: "all", reportInput: true })(
			prepared,
		).pipe(Effect.mapError((error) => failure({ reason: { _tag: "Input", error }, context: {} })));
	});
	const build: <CR>(
		request: typeof Request.Type,
		capabilities: ArtifactBuildCapabilities<CR>,
		delivery?: Pick<import("./result").BuildDelivery, "provenance">,
	) => Effect.Effect<typeof Accepted.Type, FailureValue, R | CR> = Effect.fn(
		`${policy.name}.build`,
	)(function* <CR>(
		request: typeof Request.Type,
		capabilities: ArtifactBuildCapabilities<CR>,
		delivery?: Pick<import("./result").BuildDelivery, "provenance">,
	) {
		const buildId = yield* Effect.sync(() => capabilities.createId("build"));
		const identity = {
			buildId,
			...(request.requestId ? { requestId: request.requestId } : {}),
		};
		const documentFailure = (error: E) =>
			failure({ reason: { _tag: "Document", error }, context: identity });
		const resolved = policy.resolve
			? yield* policy.resolve(request.spec).pipe(Effect.mapError(documentFailure))
			: undefined;
		const normalized = resolved ? resolved.document : policy.normalize(request.spec);
		const normalizedSpec = Result.isResult(normalized)
			? yield* Effect.fromResult(normalized).pipe(Effect.mapError(documentFailure))
			: normalized;
		const context = { ...identity, normalizedSpec };
		const checked = yield* Effect.fromResult(
			resolved?.checked ?? policy.check(normalizedSpec),
		).pipe(Effect.mapError((error) => failure({ reason: { _tag: "Document", error }, context })));
		const threshold = request.options?.minQualityScore ?? 8;
		const { nodeCount, edgeCount } = policy.counts(checked);
		const quality = policy.assess?.(checked, threshold) ?? {
			accepted: 10 >= threshold,
			score: 10,
			threshold,
			summary: { nodeCount, edgeCount },
			checks: [],
		};
		const assessed = { ...context, quality };
		if (!quality.accepted)
			return yield* failure({ reason: { _tag: "Quality", quality }, context: assessed });
		const rendered = yield* Effect.try({
			try: () => policy.render(checked),
			catch: (cause) => failure({ reason: { _tag: "Render", cause }, context: assessed }),
		}).pipe(Effect.withSpan(`${policy.name}.render`));
		const canvas = Result.isResult(rendered)
			? yield* Effect.fromResult(rendered).pipe(
					Effect.mapError((error) =>
						failure({ reason: { _tag: "Document", error }, context: assessed }),
					),
				)
			: rendered;
		const embedded = resolved ? yield* resolved.render(canvas) : { scene: canvas, issues: [] };
		const scene = embedded.scene;
		const sceneIssues = getCanvasValidationIssues(scene);
		if (sceneIssues.length > 0)
			return yield* failure({
				reason: { _tag: "Scene", issues: sceneIssues },
				context: assessed,
			});
		const finalQuality = policy.assessScene?.(checked, scene, quality) ?? quality;
		const finalContext = { ...context, quality: finalQuality };
		if (!finalQuality.accepted)
			return yield* failure({
				reason: { _tag: "Quality", quality: finalQuality },
				context: finalContext,
			});
		const artifact = yield* capabilities
			.exportScene(scene, {
				...request,
				...delivery,
				...(resolved?.storedDocument === undefined ? {} : { document: resolved.storedDocument }),
			})
			.pipe(
				Effect.mapError((error) =>
					failure({
						reason: { _tag: "Delivery", status: error.status, issues: error.issues },
						context: { ...finalContext, partial: error.partial ?? { diagramId: scene.diagramId } },
					}),
				),
			);
		return {
			ok: true,
			status: "accepted",
			...context,
			quality: finalQuality,
			artifact,
			issues: [
				...(resolved?.issues ?? []),
				...embedded.issues,
				...(policy.warnings?.(
					checked,
					"request" in request && typeof request.request === "string" ? request.request : undefined,
					scene,
					request.spec,
				) ?? []),
			],
		} satisfies typeof Accepted.Type;
	});
	return {
		...policy,
		prepare:
			policy.prepare ?? ((input: unknown): Result.Result<unknown, E> => Result.succeed(input)),
		request: Request,
		accepted: Accepted,
		rejected: Rejected,
		toolInput: ToolInput,
		input: Schema.Struct({ ...Request.fields, spec: policy.tool }),
		result: Schema.Union([Accepted, Rejected]),
		decode,
		build,
	};
}
