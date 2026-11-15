import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadArtifactReview } from "./artifact-view-client";
import { DEPLOY_PIPELINE_SCENE } from "../playground/deploy-pipeline-sample";

const load = (id: string, signal?: AbortSignal) =>
	Effect.runPromise(
		loadArtifactReview(id).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
		),
		signal ? { signal } : {},
	);
afterEach(() => vi.unstubAllGlobals());
describe("artifact review HTTP boundary", () => {
	it("reports HTTP errors before attempting to decode their body", async () => {
		const response = new Response("not JSON", { status: 404 });
		const text = vi.spyOn(response, "text");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		await expect(load("missing")).rejects.toThrow("Artifact could not be loaded.");
		expect(text).not.toHaveBeenCalled();
	});
	it("reports malformed JSON and invalid scenes with useful errors", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response("not JSON"))
			.mockResolvedValueOnce(Response.json({ ok: true, inline: {} }));
		vi.stubGlobal("fetch", fetcher);
		await expect(load("broken")).rejects.toThrow("Artifact could not be loaded.");
		await expect(load("invalid")).rejects.toThrow("Artifact scene could not be rendered.");
	});
	it("loads a valid artifact scene through the real HTTP decoder", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ ok: true, inline: DEPLOY_PIPELINE_SCENE })),
		);
		expect((await load("valid")).scene).toEqual(DEPLOY_PIPELINE_SCENE);
	});
});
