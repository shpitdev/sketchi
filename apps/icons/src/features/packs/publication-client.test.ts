// @vitest-environment node
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { afterAll, describe, expect, it, vi } from "vitest";
import { publishPack } from "./publication-client.js";

const requests: { url: string; body: unknown }[] = [];
vi.stubGlobal("window", { location: { origin: "https://icons.sketchi.app" } });
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
	const request = new Request(input, init);
	requests.push({ url: request.url, body: JSON.parse(await request.text()) });
	return Response.json(
		{ pullRequestUrl: "https://github.com/excalidraw/excalidraw-libraries/pull/4242" },
		{ status: 201 },
	);
});
afterAll(() => vi.unstubAllGlobals());
function submit(values: Record<string, string>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) form.set(key, value);
	return Effect.runPromise(
		publishPack("palantir", form).pipe(Effect.provide(FetchHttpClient.layer)),
	);
}
describe("the publication dialog's generated client", () => {
	it("decodes padded form fields and a pasted X profile before native encoding", async () => {
		const start = requests.length;
		await expect(
			submit({
				authorName: " Jane Doe ",
				website: " https://example.com/jane ",
				xHandle: " https://x.com/jane_d ",
			}),
		).resolves.toHaveProperty("pullRequestUrl");
		expect(requests.slice(start)).toEqual([
			{
				url: "https://icons.sketchi.app/api/packs/palantir/excalidraw",
				body: { authorName: "Jane Doe", website: "https://example.com/jane", xHandle: "jane_d" },
			},
		]);
	});
	it.each([
		[{ authorName: "   " }, "Add your name."],
		[
			{ authorName: "Jane", website: "http://example.com" },
			"The website must be an https:// address",
		],
		[{ authorName: "Jane", xHandle: "https://x.com/home" }, "That X link is not a profile"],
	] as const)(
		"shows a useful error before sending invalid author input %j",
		async (values, message) => {
			const start = requests.length;
			await expect(submit(values)).rejects.toThrow(message);
			expect(requests.length).toBe(start);
		},
	);
});
