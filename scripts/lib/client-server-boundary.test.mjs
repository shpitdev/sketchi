import assert from "node:assert/strict";
import test from "node:test";

import { clientServerBoundary } from "./client-server-boundary.mjs";

/** Runs the plugin over one client chunk holding these module ids; returns the error, if any. */
function clientBuildError(moduleIds) {
	const plugin = clientServerBoundary("playground");
	const bundle = {
		"client.js": { type: "chunk", modules: Object.fromEntries(moduleIds.map((id) => [id, {}])) },
	};
	try {
		plugin.generateBundle.call(
			{
				error: (message) => {
					throw new Error(message);
				},
			},
			{},
			bundle,
		);
		return undefined;
	} catch (error) {
		return error.message;
	}
}

// Regression: after apps/playground moved to apps/studio, a hard-coded feature-path pattern
// stopped matching and feature server modules could reach the client bundle unnoticed.
test("Studio client builds reject its server and feature server modules", () => {
	const root = "/repo/apps/studio/src";
	for (const leaked of [
		`${root}/server/runtime/runtime.server.ts`,
		`${root}/features/chat/model.server.ts`,
		`${root}/features/mcp/mcp-docs.server.ts?worker`,
		"C:\\repo\\apps\\studio\\src\\features\\build\\http.server.ts",
	]) {
		assert.match(clientBuildError([`${root}/routes/index.tsx`, leaked]) ?? "", /server modules/);
	}
	assert.equal(
		clientBuildError([
			`${root}/routes/index.tsx`,
			`${root}/features/chat/chat-client.ts`,
			"/repo/packages/diagrams/src/build/index.ts",
		]),
		undefined,
	);
});
