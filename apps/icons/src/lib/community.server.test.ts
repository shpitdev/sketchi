// @vitest-environment node

import { describe, expect, it } from "vitest";

import { handleCommunityList, handleCommunityPublish } from "./community.server";

describe("community icon routes", () => {
	it("answer cross-origin reads, and refuse to publish without a store", async () => {
		const list = await handleCommunityList(
			new Request("https://icons.sketchi.app/api/community"),
			{},
		);
		expect(list.status).toBe(503);
		expect(list.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const publish = await handleCommunityPublish(
			new Request("https://icons.sketchi.app/api/community", { method: "POST", body: "{}" }),
			{},
		);
		expect(publish.status).toBe(503);
		expect(await publish.json()).toMatchObject({ error: { code: "unavailable" } });
	});
});
