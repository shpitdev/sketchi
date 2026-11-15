// @vitest-environment node

import { afterAll, describe, expect, it } from "vitest";

import { makeIconsHttpHandler } from "./http.server";
const runtime = makeIconsHttpHandler();
afterAll(() => runtime.dispose());
const execute = (request: Request) =>
	runtime.fetch(
		request,
		{ ASSETS: { fetch: async () => new Response("not used", { status: 404 }) } },
		{ waitUntil: () => {} },
	);

describe("community icon routes", () => {
	it("answer cross-origin reads, and refuse to publish without a store", async () => {
		const list = await execute(new Request("https://icons.sketchi.app/api/community"));
		expect(list.status).toBe(503);
		expect(list.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const publish = await execute(
			new Request("https://icons.sketchi.app/api/community", { method: "POST", body: "{}" }),
		);
		expect(publish.status).toBe(503);
		expect(await publish.json()).toMatchObject({ error: { code: "unavailable" } });
	});
});
