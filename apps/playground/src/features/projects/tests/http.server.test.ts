import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";

import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { makeIsoDateString, makeStudioRecordId } from "../contracts";
import { makeStudioObjectStoreLayer, MemoryStudioObjectBucket } from "../bucket.server";
import {
	makeStudioRecordFactoryLayer,
	StudioProjectsLive,
	studioDrawingKey,
	studioProjectRecordKey,
} from "../service.server";
import { makeStudioSessionServiceLayer } from "../session.server";
import { StudioSourceArtifactError } from "../errors.server";
import {
	StudioSourceArtifactStore,
	type StudioSourceArtifactStoreShape,
} from "../source-artifacts.server";
import { studioHttp } from "../http.server";
import { STUDIO_DRAWING_MAX_BYTES } from "../http-api";

class TestSourceArtifacts implements StudioSourceArtifactStoreShape {
	readonly artifacts = new Map<string, { diagramId: string; title: string }>();

	load(artifactId: string) {
		const artifact = this.artifacts.get(artifactId);
		if (!artifact) {
			return Effect.fail(
				StudioSourceArtifactError.make({
					artifactId,
					code: "not_found",
					message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
					status: 404,
				}),
			);
		}

		return Effect.succeed(artifact);
	}
}

function createTestServer<
	SourceArtifacts extends StudioSourceArtifactStoreShape = TestSourceArtifacts,
>(
	bucket = new MemoryStudioObjectBucket(),
	sourceArtifacts: SourceArtifacts = new TestSourceArtifacts() as unknown as SourceArtifacts,
	overrides: {
		createId?: (kind: "dia" | "proj") => string;
		now?: () => string;
	} = {},
) {
	const dependencies = Layer.mergeAll(
		makeStudioObjectStoreLayer(bucket),
		Layer.succeed(StudioSourceArtifactStore, sourceArtifacts),
		makeStudioRecordFactoryLayer({
			createId: (kind) =>
				makeStudioRecordId(
					(
						overrides.createId ??
						((recordKind) => (recordKind === "proj" ? "proj_test" : "dia_test"))
					)(kind),
				),
			now: Effect.sync(() => makeIsoDateString(overrides.now?.() ?? "2026-07-20T02:00:00.000Z")),
		}),
		makeStudioSessionServiceLayer({ createSessionId: () => "anon_abcdefghijklmnop" }),
	);
	const appLayer = StudioProjectsLive.pipe(Layer.provideMerge(dependencies));
	const run = (request: Request) =>
		Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const handler = yield* studioHttp;
					const response = yield* handler.pipe(
						Effect.provideService(
							HttpServerRequest.HttpServerRequest,
							HttpServerRequest.fromWeb(request),
						),
					);
					return HttpServerResponse.toWeb(response);
				}),
			).pipe(Effect.provide(appLayer)),
			{ signal: request.signal },
		);
	return {
		bucket,
		server: {
			handleCreateFromArtifactRequest: run,
			handleGetDiagramRequest: (request: Request, _id: string) => run(request),
			handleGetProjectRequest: (request: Request, _id: string) => run(request),
			handleListProjectsRequest: run,
			handleGetDrawingRequest: (request: Request, _id: string) => run(request),
			handleSaveDrawingRequest: (request: Request, _id: string) => run(request),
		},
		sourceArtifacts,
	};
}

function postRequest(
	url: string,
	body: unknown,
	headers: HeadersInit = {},
	signal?: AbortSignal,
): Request {
	return new Request(url, {
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
		...(signal ? { signal } : {}),
	});
}

function requestWithSession(url: string, sessionId: string): Request {
	return new Request(url, {
		headers: { Cookie: `sketchi_studio_session=${sessionId}` },
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedString(value: unknown, parentKey: string, childKey: string): string {
	if (isRecord(value)) {
		const parent = value[parentKey];
		if (isRecord(parent) && typeof parent[childKey] === "string") {
			return parent[childKey];
		}
	}
	throw new Error(`Response did not contain ${parentKey}.${childKey}.`);
}

describe("Studio project HTTP runtime edge", () => {
	it("keeps ownership failures concealed behind the existing 404 contract", async () => {
		const firstSession = "anon_abcdefghijklmnop";
		const secondSession = "anon_qrstuvwxyzabcdef";
		const { server, sourceArtifacts } = createTestServer();
		sourceArtifacts.artifacts.set("artifact-isolated", {
			diagramId: "isolated-flow",
			title: "Isolated Studio project",
		});
		const createResponse = await server.handleCreateFromArtifactRequest(
			postRequest(
				"https://studio.test/api/studio/projects/from-artifact",
				{ artifactId: "artifact-isolated" },
				{ Cookie: `sketchi_studio_session=${firstSession}` },
			),
		);
		const created: unknown = await createResponse.json();
		const projectId = nestedString(created, "project", "id");
		const diagramId = nestedString(created, "diagram", "id");

		const deniedProject = await server.handleGetProjectRequest(
			requestWithSession(`https://studio.test/api/studio/projects/${projectId}`, secondSession),
			projectId,
		);
		const deniedDiagram = await server.handleGetDiagramRequest(
			requestWithSession(`https://studio.test/api/studio/diagrams/${diagramId}`, secondSession),
			diagramId,
		);

		expect(deniedProject.status).toBe(404);
		expect(deniedDiagram.status).toBe(404);
		await expect(deniedProject.json()).resolves.toMatchObject({
			code: "not_found",
			message: "Studio project was not found for this session.",
			ok: false,
		});
	});

	it("propagates request cancellation without committing records", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const controller = new AbortController();
		let sourceInterrupted = false;
		let sourceLoadStarted: (() => void) | undefined;
		const sourceStarted = new Promise<void>((resolve) => {
			sourceLoadStarted = resolve;
		});
		const sourceArtifacts: StudioSourceArtifactStoreShape = {
			load: () =>
				Effect.sync(() => sourceLoadStarted?.()).pipe(
					Effect.andThen(Effect.never),
					Effect.onInterrupt(() =>
						Effect.sync(() => {
							sourceInterrupted = true;
						}),
					),
				),
		};
		const { server } = createTestServer(bucket, sourceArtifacts);
		const response = server.handleCreateFromArtifactRequest(
			postRequest(
				"https://studio.test/api/studio/projects/from-artifact",
				{ artifactId: "artifact-cancelled" },
				{},
				controller.signal,
			),
		);

		await sourceStarted;
		controller.abort();

		await expect(response).rejects.toThrow("All fibers interrupted without error");
		expect(sourceInterrupted).toBe(true);
		expect(bucket.objects.size).toBe(0);
	});
});

describe("Studio drawing Save", () => {
	const sessionId = "anon_abcdefghijklmnop";
	const cookie = { Cookie: `sketchi_studio_session=${sessionId}` };
	const drawingUrl = "https://studio.test/api/studio/diagrams/dia_saved/drawing";
	const drawing = {
		appState: { viewBackgroundColor: "#fffdf8" },
		elements: [{ id: "box", type: "rectangle", version: 3, x: 10, y: 20 }],
		files: {},
	};

	function putDrawing(body: unknown, headers: HeadersInit = cookie): Request {
		return new Request(drawingUrl, {
			body: typeof body === "string" ? body : JSON.stringify(body),
			headers: { "Content-Type": "application/json", ...headers },
			method: "PUT",
		});
	}

	async function savedDiagram() {
		let tick = 0;
		const test = createTestServer(new MemoryStudioObjectBucket(), new TestSourceArtifacts(), {
			createId: (kind) => (kind === "proj" ? "proj_saved" : "dia_saved"),
			now: () => `2026-07-20T02:00:0${tick++}.000Z`,
		});
		test.sourceArtifacts.artifacts.set("artifact-saved", { diagramId: "flow", title: "Saved" });
		const created = await test.server.handleCreateFromArtifactRequest(
			postRequest(
				"https://studio.test/api/studio/projects/from-artifact",
				{ artifactId: "artifact-saved" },
				cookie,
			),
		);
		expect(created.status).toBe(200);
		return test;
	}

	it("publishes Create only after complete metadata and conceals prepublication reads", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const beforePublish = Promise.withResolvers<void>();
		const publish = Promise.withResolvers<void>();
		const original = bucket.put.bind(bucket);
		vi.spyOn(bucket, "put").mockImplementation(async (key, value) => {
			if (key === studioProjectRecordKey("proj_saved")) {
				beforePublish.resolve();
				await publish.promise;
			}
			return original(key, value);
		});
		const { server, sourceArtifacts } = createTestServer(bucket, new TestSourceArtifacts(), {
			createId: (kind) => (kind === "proj" ? "proj_saved" : "dia_saved"),
		});
		sourceArtifacts.artifacts.set("artifact-saved", { diagramId: "flow", title: "Saved" });
		const creating = server.handleCreateFromArtifactRequest(
			postRequest(
				"https://studio.test/api/studio/projects/from-artifact",
				{ artifactId: "artifact-saved" },
				cookie,
			),
		);
		await beforePublish.promise;
		const hiddenDiagram = await server.handleGetDiagramRequest(
			requestWithSession("https://studio.test/api/studio/diagrams/dia_saved", sessionId),
			"dia_saved",
		);
		const hiddenProject = await server.handleGetProjectRequest(
			requestWithSession("https://studio.test/api/studio/projects/proj_saved", sessionId),
			"proj_saved",
		);
		const list = await server.handleListProjectsRequest(
			requestWithSession("https://studio.test/api/studio/projects", sessionId),
		);
		expect(hiddenDiagram.status).toBe(404);
		expect(hiddenProject.status).toBe(404);
		expect(await list.json()).toMatchObject({ projects: [] });
		publish.resolve();
		expect((await creating).status).toBe(200);
		const visible = await server.handleGetDiagramRequest(
			requestWithSession("https://studio.test/api/studio/diagrams/dia_saved", sessionId),
			"dia_saved",
		);
		expect(visible.status).toBe(200);
	});

	it("conceals a failed Create even when the final write committed and compensation cannot remove its project", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const put = bucket.put.bind(bucket),
			remove = bucket.delete.bind(bucket);
		vi.spyOn(bucket, "put").mockImplementation(async (key, value) => {
			const metadata = await put(key, value);
			if (key === studioProjectRecordKey("proj_saved")) throw new Error("commit response lost");
			return metadata;
		});
		vi.spyOn(bucket, "delete").mockImplementation(async (key) => {
			if (key === studioProjectRecordKey("proj_saved")) throw new Error("cleanup denied");
			return remove(key);
		});
		const { server, sourceArtifacts } = createTestServer(bucket, new TestSourceArtifacts(), {
			createId: (kind) => (kind === "proj" ? "proj_saved" : "dia_saved"),
		});
		sourceArtifacts.artifacts.set("artifact-saved", { diagramId: "flow", title: "Saved" });
		expect(
			(
				await server.handleCreateFromArtifactRequest(
					postRequest(
						"https://studio.test/api/studio/projects/from-artifact",
						{ artifactId: "artifact-saved" },
						cookie,
					),
				)
			).status,
		).toBe(500);
		expect(bucket.objects.has(studioProjectRecordKey("proj_saved"))).toBe(true);
		expect(
			(
				await server.handleGetProjectRequest(
					requestWithSession("https://studio.test/api/studio/projects/proj_saved", sessionId),
					"proj_saved",
				)
			).status,
		).toBe(404);
		expect(
			(
				await server.handleGetDiagramRequest(
					requestWithSession("https://studio.test/api/studio/diagrams/dia_saved", sessionId),
					"dia_saved",
				)
			).status,
		).toBe(404);
	});

	it("keeps the previous drawing when the one atomic Save write is rejected", async () => {
		const { bucket, server } = await savedDiagram();
		expect((await server.handleSaveDrawingRequest(putDrawing(drawing), "dia_saved")).status).toBe(
			200,
		);
		const metadataBefore = new Map(bucket.metadata);
		const bytesBefore = new Map(bucket.objects);
		const write = vi.spyOn(bucket, "put").mockRejectedValue(new Error("R2 write rejected"));
		const rejected = {
			...drawing,
			elements: [{ id: "rejected", type: "text", text: "NOT SAVED" }],
		};
		const result = await server.handleSaveDrawingRequest(putDrawing(rejected), "dia_saved");
		expect(result.status).toBe(500);
		expect(write.mock.calls.map(([key]) => key)).toEqual([studioDrawingKey("dia_saved")]);
		const read = await server.handleGetDrawingRequest(
			requestWithSession(drawingUrl, sessionId),
			"dia_saved",
		);
		expect(await read.json()).toMatchObject({ ok: true, drawing });
		expect(bucket.objects).toEqual(bytesBefore);
		expect(bucket.metadata).toEqual(metadataBefore);
	});

	it("observes a complete drawing and native metadata after a commit with an ambiguous response", async () => {
		const { bucket, server } = await savedDiagram();
		const put = bucket.put.bind(bucket);
		vi.spyOn(bucket, "put").mockImplementation(async (key, value) => {
			await put(key, value);
			throw new Error("response lost after commit");
		});
		const response = await server.handleSaveDrawingRequest(putDrawing(drawing), "dia_saved");
		expect(response.status).toBe(500);
		const read = await server.handleGetDrawingRequest(
			requestWithSession(drawingUrl, sessionId),
			"dia_saved",
		);
		expect(await read.json()).toMatchObject({ drawing });
		const details = await server.handleGetDiagramRequest(
			requestWithSession("https://studio.test/api/studio/diagrams/dia_saved", sessionId),
			"dia_saved",
		);
		expect(await details.json()).toMatchObject({
			diagram: {
				savedAt: bucket.metadata.get(studioDrawingKey("dia_saved"))?.uploaded.toISOString(),
			},
		});
	});

	it("refuses another session's Save and keeps the drawing", async () => {
		const { bucket, server } = await savedDiagram();
		await server.handleSaveDrawingRequest(putDrawing(drawing), "dia_saved");

		const other = await server.handleSaveDrawingRequest(
			putDrawing(
				{ ...drawing, elements: [] },
				{ Cookie: "sketchi_studio_session=anon_zyxwvutsrqponmlk" },
			),
			"dia_saved",
		);
		expect(other.status).toBe(404);
		expect(JSON.parse(String(bucket.objects.get(studioDrawingKey("dia_saved"))))).toEqual(drawing);
	});

	it("rejects a drawing over the size limit before reading it", async () => {
		const { server } = await savedDiagram();
		const request = putDrawing(drawing, {
			...cookie,
			"Content-Length": String(STUDIO_DRAWING_MAX_BYTES + 1),
		});
		const body = request.body;
		if (!body) throw new Error("Missing drawing request body");
		const read = vi.spyOn(body, "getReader");
		const response = await server.handleSaveDrawingRequest(request, "dia_saved");
		expect(read).not.toHaveBeenCalled();
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ message: "The drawing is too large to save." });
	});
	it("bounds actual UTF-8 drawing bytes when Content-Length is absent", async () => {
		const { bucket, server } = await savedDiagram();
		const request = putDrawing("é".repeat(STUDIO_DRAWING_MAX_BYTES / 2 + 1));
		expect(request.headers.has("content-length")).toBe(false);
		const response = await server.handleSaveDrawingRequest(request, "dia_saved");
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "invalid_input",
			message: "The drawing is too large to save.",
		});
		expect(bucket.objects.has(studioDrawingKey("dia_saved"))).toBe(false);
	});
	it("stops and cancels the actual chunked body at the native byte limit before decoding or writing", async () => {
		const { bucket, server } = await savedDiagram();
		let pulls = 0,
			cancelled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new Uint8Array(STUDIO_DRAWING_MAX_BYTES / 2 + 1));
				},
				cancel() {
					cancelled = true;
				},
			},
			{ highWaterMark: 0 },
		);
		const init: RequestInit & { duplex: "half" } = {
			method: "PUT",
			headers: { ...cookie, "content-type": "application/json" },
			body,
			duplex: "half",
		};
		const response = await server.handleSaveDrawingRequest(
			new Request(drawingUrl, init),
			"dia_saved",
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "invalid_input",
			message: "The drawing is too large to save.",
		});
		expect(pulls).toBe(2);
		expect(cancelled).toBe(true);
		expect(bucket.objects.has(studioDrawingKey("dia_saved"))).toBe(false);
	});
});
