import { type FlowchartDocument } from "@sketchi/diagrams/families/flowchart/document";
import { familyForType } from "@sketchi/diagrams/family";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { MemoryStudioObjectBucket } from "../../features/projects/bucket.server";

import type { StudioEnv } from "../bindings/studio-env.server";
import * as Build from "@sketchi/diagrams/build/code-mode/runtime";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { handleStudioProjectsRequest } from "./projects.server";
import { makePlaygroundRuntime } from "../runtime/runtime.server";

function testBoundary(env: StudioEnv, request: Request) {
	return {
		env,
		request,
		platform: {
			waitUntilPromise: (promise: Promise<unknown>) => {
				void promise;
			},
		},
	};
}

function handleCreateStudioProjectFromArtifactRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(handleStudioProjectsRequest(request), testBoundary(env, request));
}

function handleListStudioProjectsRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(handleStudioProjectsRequest(request), testBoundary(env, request));
}

function flowchartSpec(title: string): FlowchartDocument {
	return {
		title,
		direction: "LR",
		nodes: {
			draft: "Draft diagram",
			persist: "Save artifact",
			done: "Persisted",
		},
		edges: [
			["draft", "persist"],
			["persist", "done"],
		],
	};
}

function postArtifact(artifactId: string): Request {
	return new Request("https://studio.test/api/studio/projects/from-artifact", {
		body: JSON.stringify({ artifactId }),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
}

async function createArtifact(bucket: MemoryStudioObjectBucket, title: string): Promise<string> {
	const request = new Request("https://studio.test/test-artifact", {
		method: "POST",
	});
	const env = { SKETCHI_ARTIFACTS: bucket };
	const result = await runPlaygroundEffect(
		Effect.gen(function* () {
			return yield* buildResponse(
				familyForType("flowchart").build(Build)({
					spec: flowchartSpec(title),
					options: {
						artifactFormats: ["scene", "excalidraw"],
						inlineArtifacts: ["scene"],
					},
				}),
			);
		}),
		testBoundary(env, request),
	);

	if (!result.ok) {
		throw new Error("Expected the test artifact to be accepted.");
	}
	return result.artifact.artifactId;
}

describe("Studio project app adapter", () => {
	it("loads and validates a Code Mode scene before returning the HTTP success response", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const artifactId = await createArtifact(bucket, "Validated Studio artifact");

		const response = await handleCreateStudioProjectFromArtifactRequest(
			{ SKETCHI_ARTIFACTS: bucket },
			postArtifact(artifactId),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			diagram: {
				artifactId,
				title: "Validated Studio artifact",
			},
			ok: true,
			project: {
				title: "Validated Studio artifact",
			},
		});
	});

	it("maps a malformed stored scene to the preserved invalid_scene response", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const artifactId = await createArtifact(bucket, "Malformed scene source");
		await bucket.put(
			`codemode/${artifactId}/scene.json`,
			JSON.stringify({ title: "Missing renderable scene fields" }),
		);

		const response = await handleCreateStudioProjectFromArtifactRequest(
			{ SKETCHI_ARTIFACTS: bucket },
			postArtifact(artifactId),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			code: "invalid_scene",
			message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
			ok: false,
		});
	});

	it("maps a missing Code Mode artifact to the preserved not_found response", async () => {
		const bucket = new MemoryStudioObjectBucket();
		const response = await handleCreateStudioProjectFromArtifactRequest(
			{ SKETCHI_ARTIFACTS: bucket },
			postArtifact("missing-artifact"),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			code: "not_found",
			message: 'Playground artifact "missing-artifact" is not available for Studio persistence.',
			ok: false,
		});
	});

	it("keeps binding-shape failures inside the Studio JSON error response", async () => {
		const bucketWithoutList = {
			async get() {
				return null;
			},
			async put() {
				return null;
			},
		};
		const response = await handleListStudioProjectsRequest(
			{ SKETCHI_ARTIFACTS: bucketWithoutList },
			new Request("https://studio.test/api/studio/projects"),
		);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({
			code: "storage_failed",
			message: "Studio persistence failed.",
			ok: false,
		});
	});
	it("keeps project data and request ownership across bindings and origins", async () => {
		const runtime = makePlaygroundRuntime();
		const firstBucket = new MemoryStudioObjectBucket();
		const secondBucket = new MemoryStudioObjectBucket();
		const env = { SKETCHI_ARTIFACTS: firstBucket };
		const list = (cookie: string, origin = "https://studio.test") =>
			new Request(`${origin}/api/studio/projects`, {
				headers: { Cookie: cookie },
			});
		const cookie = "sketchi_studio_session=anon_lifecycle_owner";
		try {
			const built = await runtime.run(
				Effect.gen(function* () {
					return yield* buildResponse(
						familyForType("flowchart").build(Build)({
							spec: {
								title: "Lifecycle source",
								nodes: {
									start: "Change proposed",
									review: "Review evidence",
									end: "Change recorded",
								},
								edges: [
									["start", "review"],
									["review", "end"],
								],
							},
							options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
						}),
					);
				}),
				testBoundary(env, new Request("https://studio.test/build")),
			);
			if (!built.ok) throw new Error("Expected the offline artifact to be accepted.");
			const request = new Request("https://first.test/api/studio/projects/from-artifact", {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ artifactId: built.artifact.artifactId }),
			});
			const created = await runtime.run(
				handleStudioProjectsRequest(request),
				testBoundary(env, request),
			);
			expect(created.status).toBe(200);
			const [first, second] = await Promise.all([
				runtime.run(
					handleStudioProjectsRequest(list(cookie)),
					testBoundary({ ...env }, list(cookie)),
				),
				runtime.run(
					handleStudioProjectsRequest(list(cookie, "https://second.test")),
					testBoundary({ ...env }, list(cookie, "https://second.test")),
				),
			]);
			for (const response of [first, second]) {
				expect(await response.json()).toMatchObject({
					ok: true,
					projects: [{ title: "Lifecycle source" }],
				});
			}
			const otherOwner = list("sketchi_studio_session=anon_other_owner");
			const privateList = await runtime.run(
				handleStudioProjectsRequest(otherOwner),
				testBoundary(env, otherOwner),
			);
			expect(await privateList.json()).toMatchObject({ projects: [] });
			const otherBucket = list(cookie);
			const isolated = await runtime.run(
				handleStudioProjectsRequest(otherBucket),
				testBoundary({ SKETCHI_ARTIFACTS: secondBucket }, otherBucket),
			);
			expect(await isolated.json()).toMatchObject({ projects: [] });
			await Promise.all(
				[{}, {}].map((localEnv) => {
					const localRequest = list(cookie);
					return runtime.run(
						handleStudioProjectsRequest(localRequest),
						testBoundary(localEnv, localRequest),
					);
				}),
			);
		} finally {
			await runtime.dispose();
		}
	});
});
