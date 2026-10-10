import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const manifest = JSON.parse(read("package.json"));
const agentsEntry = require.resolve("agents");
const agentsManifest = JSON.parse(
	readFileSync(join(dirname(agentsEntry), "..", "package.json"), "utf8"),
);

test("keeps the server-only Agents compatibility exception patched and bounded", () => {
	assert.equal(manifest.dependencies.agents, "0.26.0");
	assert.equal(
		agentsManifest.peerDependencies["@modelcontextprotocol/sdk"],
		"1.30.0",
		"remove the exception when the eligible Agents release changes its SDK peer",
	);
	assert.equal(
		manifest.dependencies["@modelcontextprotocol/sdk"],
		"1.32.1",
		"GHSA-6qxp-vccf-f47h requires SDK 1.31.0 or later",
	);

	for (const path of [
		"apps/icons/src/lib/mcp.server.ts",
		"apps/playground/src/server/codemode/mcp.server.ts",
		"apps/playground/src/server/codemode/effect-mcp-adapter.server.ts",
	]) {
		const source = read(path);
		assert.match(source, /@modelcontextprotocol\/sdk\/server\/index\.js/);
		assert.doesNotMatch(
			source,
			/@modelcontextprotocol\/sdk\/client|authProvider|withOAuth|fetchToken\(|\bauth\(/,
			`${path} entered the OAuth-client scope and needs a fresh security review`,
		);
	}

	for (const path of [
		"apps/icons/src/lib/mcp.server.ts",
		"apps/playground/src/server/codemode/mcp.server.ts",
	]) {
		assert.match(read(path), /import\("agents\/mcp"\)/);
	}
});
