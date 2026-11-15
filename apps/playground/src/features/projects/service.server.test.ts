import { assert, describe, it } from "@effect/vitest";
import { makeTelemetryTestSink, makeWorkersTelemetryLayer } from "@sketchi/observability";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";

import {
	AuthenticatedStudioOwner,
	makeIsoDateString,
	makeStudioRecordId,
	type StudioProjectRecord,
} from "./contracts.js";
import {
	makeStudioObjectStoreLayer,
	MemoryStudioObjectBucket,
	StudioObjectStore,
	type StudioObjectStoreShape,
	type StudioObjectBucketBody,
} from "./bucket.server.js";
import { StudioOwnershipError } from "./errors.server.js";
import {
	makeStudioRecordFactoryLayer,
	StudioProjects,
	StudioProjectsLive,
	studioOwnerKey,
	studioOwnerProjectsPrefix,
	studioProjectRecordKey,
} from "./service.server.js";
import { makeStudioSessionServiceLayer, StudioSessionService } from "./session.server.js";
import { StudioSourceArtifactStore } from "./source-artifacts.server.js";

const owner = AuthenticatedStudioOwner.make({
	kind: "authenticated",
	subjectId: "user_effect_tests",
});

describe("Studio schema contracts", () => {
	it.each(["AAAAAK", "AAAAAſ", "AAAAAK", "AAAAAS"])(
		"preserves fold-aware identifier acceptance for %s",
		(id) => assert.strictEqual(makeStudioRecordId(id), id),
	);

	it.each(["AAAAA", "AAAAA!", "AAAAAé"])("rejects an out-of-contract identifier %s", (id) =>
		assert.throws(() => makeStudioRecordId(id)),
	);
});

function projectLayer(options: {
	bucket?: MemoryStudioObjectBucket;
	objectStore?: StudioObjectStoreShape;
	sourceArtifact?: { diagramId: string; title: string };
}) {
	const objectStoreLayer = options.objectStore
		? Layer.succeed(StudioObjectStore, options.objectStore)
		: makeStudioObjectStoreLayer(options.bucket ?? new MemoryStudioObjectBucket());
	const sourceLayer = Layer.succeed(StudioSourceArtifactStore, {
		load: () =>
			Effect.succeed(
				options.sourceArtifact ?? {
					diagramId: "artifact-diagram",
					title: "Effect Studio project",
				},
			),
	});
	const dependencies = Layer.mergeAll(
		objectStoreLayer,
		sourceLayer,
		makeStudioRecordFactoryLayer({
			createId: (kind) =>
				makeStudioRecordId(kind === "proj" ? "proj_effecttest" : "dia_effecttest"),
			now: Effect.succeed(makeIsoDateString("2026-07-20T03:00:00.000Z")),
		}),
	);

	return StudioProjectsLive.pipe(Layer.provide(dependencies));
}

describe("StudioProjects Effect service", () => {
	const bucket = new MemoryStudioObjectBucket();

	for (const failedWrite of [1, 2, 3]) {
		for (const failCleanup of [false, true]) {
			it.effect(
				`compensates write ${failedWrite} failure (cleanup failure: ${failCleanup}) without replacing its cause`,
				() => {
					const failure = new Error("partial R2 write failure");
					let writes = 0;
					class PartialWriteBucket extends MemoryStudioObjectBucket {
						override async put(key: string, value: StudioObjectBucketBody) {
							const metadata = await super.put(key, value);
							writes += 1;
							if (writes === failedWrite) throw failure;
							return metadata;
						}
						override async delete(key: string) {
							if (failCleanup && key === studioProjectRecordKey("proj_effecttest")) {
								throw new Error("cleanup failed");
							}
							return super.delete(key);
						}
					}
					const partialBucket = new PartialWriteBucket();
					partialBucket.objects.set("unrelated.json", "preserved");
					return Effect.gen(function* () {
						const projects = yield* StudioProjects;
						const error = yield* Effect.flip(
							projects.createFromArtifact({
								artifactId: "artifact-partial",
								session: owner,
							}),
						);
						assert.strictEqual(error._tag, "StudioStorageError");
						if (error._tag === "StudioStorageError") {
							assert.strictEqual(error.cause, failure);
							assert.strictEqual(error.operation, "put");
						}

						const expected = new Map([["unrelated.json", "preserved"]]);
						if (failCleanup && failedWrite === 3) {
							const key = studioProjectRecordKey("proj_effecttest");
							const record = partialBucket.objects.get(key);
							assert.isString(record);
							if (typeof record === "string") expected.set(key, record);
						}
						assert.deepStrictEqual(partialBucket.objects, expected);
					}).pipe(Effect.provide(projectLayer({ bucket: partialBucket })));
				},
			);
		}
	}

	it.effect("compensates an interrupted partial create without translating cancellation", () => {
		const records = new Map<string, StudioObjectBucketBody>();
		let writes = 0;
		const objectStore: StudioObjectStoreShape = {
			head: () => Effect.succeed(null),
			delete: (key) =>
				Effect.sync(() => {
					records.delete(key);
				}),
			getText: () => Effect.succeed(null),
			list: () => Effect.succeed({ objects: [], truncated: false }),
			put: (key, value) =>
				Effect.sync(() => {
					records.set(key, value);
					writes += 1;
				}).pipe(
					Effect.andThen(
						Effect.suspend(() =>
							writes === 2 ? Effect.never : Effect.succeed({ uploaded: new Date(0), etag: "test" }),
						),
					),
				),
		};
		return Effect.gen(function* () {
			const projects = yield* StudioProjects;
			const fiber = yield* Effect.forkChild(
				projects.createFromArtifact({
					artifactId: "artifact-cancelled",
					session: owner,
				}),
			);
			while (writes < 2) yield* Effect.yieldNow;
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
			assert.strictEqual(records.size, 0);
		}).pipe(Effect.provide(projectLayer({ objectStore })));
	});

	it.effect("correlates persistence spans and typed boundary metrics", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-studio-test" },
			sink,
		});
		return Effect.gen(function* () {
			const projects = yield* StudioProjects;
			const created = yield* projects.createFromArtifact({
				artifactId: "artifact-telemetry",
				session: owner,
			});
			const missing = yield* Effect.flip(projects.getProject(owner, "proj_missing_telemetry"));
			assert.strictEqual(missing._tag, "StudioNotFoundError");

			const spans = probe.spans;
			const metrics = probe.metrics;
			assert.deepInclude(
				spans.find((span) => span.name === "studioPersistence.projects.createFromArtifact")
					?.attributes,
				{ "sketchi.artifact_id": "artifact-telemetry" },
			);
			assert.deepInclude(
				spans.find(
					(span) =>
						span.name === "studioPersistence.putJson" &&
						span.attributes["sketchi.project_id"] === "proj_effecttest",
				)?.attributes,
				{
					"sketchi.artifact_id": "artifact-telemetry",
					"sketchi.project_id": "proj_effecttest",
				},
			);
			assert.deepInclude(
				spans.find(
					(span) =>
						span.name === "studioPersistence.projects.getProject" && span.outcome === "failure",
				),
				{ error_tag: "StudioNotFoundError" },
			);
			assert.deepInclude(
				metrics.find((metric) => metric.metric === "sketchi_studio_persistence_failures")
					?.attributes,
				{
					failure_category: "StudioNotFoundError",
					operation: "getProject",
					surface: "studio",
				},
			);
			assert.strictEqual(created.project.id, "proj_effecttest");
		}).pipe(Effect.provide(Layer.merge(projectLayer({}), telemetryLayer)));
	});

	it.layer(projectLayer({ bucket }))("in-memory persistence", (it) => {
		it.effect("creates, reads, and lists through the service layer", () =>
			Effect.gen(function* () {
				const projects = yield* StudioProjects;
				const created = yield* projects.createFromArtifact({
					artifactId: "artifact-effect",
					session: owner,
				});
				const loaded = yield* projects.getProject(owner, created.project.id);
				const listed = yield* projects.listProjects(owner);

				assert.strictEqual(created.project.id, "proj_effecttest");
				assert.strictEqual(loaded.diagrams[0]?.id, "dia_effecttest");
				assert.deepStrictEqual(
					listed.map((project) => project.id),
					["proj_effecttest"],
				);
			}),
		);
	});

	it.layer(projectLayer({}))("missing records", (it) => {
		it.effect("distinguishes object absence with StudioNotFoundError", () =>
			Effect.gen(function* () {
				const projects = yield* StudioProjects;
				const error = yield* Effect.flip(projects.getProject(owner, "proj_missing"));

				assert.strictEqual(error._tag, "StudioNotFoundError");
				if (error._tag === "StudioNotFoundError") {
					assert.strictEqual(error.resource, "project");
					assert.strictEqual(error.id, "proj_missing");
				}
			}),
		);
	});

	const corruptBucket = new MemoryStudioObjectBucket();
	corruptBucket.objects.set(
		studioProjectRecordKey("proj_corrupt"),
		JSON.stringify({ id: "proj_corrupt" }),
	);

	it.layer(projectLayer({ bucket: corruptBucket }))("corrupt records", (it) => {
		it.effect("returns typed corruption instead of absence", () =>
			Effect.gen(function* () {
				const projects = yield* StudioProjects;
				const error = yield* Effect.flip(projects.getProject(owner, "proj_corrupt"));

				assert.strictEqual(error._tag, "StudioDecodeError");
				if (error._tag === "StudioDecodeError") {
					assert.strictEqual(error.operation, "decode");
					assert.strictEqual(error.key, "studio/projects/proj_corrupt.json");
					assert.instanceOf(error.cause, Error);
				}
			}),
		);
	});

	const emptyBucket = new MemoryStudioObjectBucket();
	emptyBucket.objects.set(studioProjectRecordKey("proj_empty"), "");

	it.layer(projectLayer({ bucket: emptyBucket }))("empty records", (it) => {
		it.effect("models empty stored bytes as typed corruption", () =>
			Effect.gen(function* () {
				const projects = yield* StudioProjects;
				const error = yield* Effect.flip(projects.getProject(owner, "proj_empty"));

				assert.strictEqual(error._tag, "StudioDecodeError");
				if (error._tag === "StudioDecodeError") {
					assert.strictEqual(error.operation, "decode");
					assert.strictEqual(error.key, "studio/projects/proj_empty.json");
					assert.instanceOf(error.cause, Error);
				}
			}),
		);
	});

	const otherOwnerBucket = new MemoryStudioObjectBucket();
	const otherOwner = AuthenticatedStudioOwner.make({
		kind: "authenticated",
		subjectId: "user_other",
	});
	const mismatchedRecord: StudioProjectRecord = {
		createdAt: makeIsoDateString("2026-07-20T03:00:00.000Z"),
		diagramIds: [],
		id: makeStudioRecordId("proj_private"),
		owner: otherOwner,
		source: { artifactId: "artifact-private", kind: "playground-artifact" },
		title: "Private project",
		updatedAt: makeIsoDateString("2026-07-20T03:00:00.000Z"),
	};
	otherOwnerBucket.objects.set(
		studioProjectRecordKey(mismatchedRecord.id),
		JSON.stringify(mismatchedRecord),
	);

	it.layer(projectLayer({ bucket: otherOwnerBucket }))("ownership checks", (it) => {
		it.effect("returns a typed ownership failure", () =>
			Effect.gen(function* () {
				const projects = yield* StudioProjects;
				const error = yield* Effect.flip(projects.getProject(owner, mismatchedRecord.id));

				assert.instanceOf(error, StudioOwnershipError);
				assert.strictEqual(error._tag, "StudioOwnershipError");
				if (error._tag === "StudioOwnershipError") {
					assert.strictEqual(error.resource, "project");
				}
			}),
		);
	});

	let active = 0;
	let maxActive = 0;
	let released = 0;
	const projectIds = Array.from({ length: 17 }, (_, index) => `proj_concurrency_${String(index)}`);
	const entryPrefix = studioOwnerProjectsPrefix(owner);
	const concurrencyObjectStore: StudioObjectStoreShape = {
		head: () => Effect.succeed(null),
		delete: () => Effect.void,
		getText: (key) => {
			if (key.startsWith(entryPrefix)) {
				const projectId = key.slice(entryPrefix.length, -".json".length);
				return Effect.succeed(
					JSON.stringify({
						ownerKey: studioOwnerKey(owner),
						projectId,
						updatedAt: "2026-07-20T03:00:00.000Z",
					}),
				);
			}

			return Effect.acquireUseRelease(
				Effect.sync(() => {
					active += 1;
					maxActive = Math.max(maxActive, active);
				}),
				() => Effect.never,
				() =>
					Effect.sync(() => {
						active -= 1;
						released += 1;
					}),
			);
		},
		list: () =>
			Effect.succeed({
				objects: projectIds.map((projectId) => ({
					key: `${entryPrefix}${projectId}.json`,
				})),
				truncated: false,
			}),
		put: () => Effect.succeed({ uploaded: new Date(0), etag: "test" }),
	};

	it.layer(projectLayer({ objectStore: concurrencyObjectStore }))("bounded listing", (it) => {
		it.effect("bounds listing to eight and releases in-flight work on interruption", () =>
			Effect.gen(function* () {
				active = 0;
				maxActive = 0;
				released = 0;
				const projects = yield* StudioProjects;
				const fiber = yield* Effect.forkChild(projects.listProjects(owner));

				while (active < 8) {
					yield* Effect.yieldNow;
				}

				assert.strictEqual(active, 8);
				assert.strictEqual(maxActive, 8);
				yield* Fiber.interrupt(fiber);
				const exit = yield* Fiber.await(fiber);

				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isTrue(Cause.hasInterrupts(exit.cause));
				}
				assert.strictEqual(active, 0);
				assert.strictEqual(released, 8);
			}),
		);
	});
});

describe("StudioSessionService", () => {
	it.layer(
		makeStudioSessionServiceLayer({
			createSessionId: () => "proj_abcdefghijklmnop",
		}),
	)("invalid session factory", (it) => {
		it.effect("keeps a generated invalid session id as a typed configuration failure", () =>
			Effect.gen(function* () {
				const sessions = yield* StudioSessionService;
				const error = yield* Effect.flip(
					sessions.resolve(new Request("https://studio.test/api/studio/projects")),
				);
				assert.strictEqual(error._tag, "StudioSessionError");
				assert.instanceOf(error.cause, Error);
			}),
		);
	});
});
