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

const semver = (version) => version.split(".").map(Number);
const atLeast = (version, minimum) => {
	const [a, b] = [semver(version), semver(minimum)];
	for (let index = 0; index < 3; index += 1) {
		if (a[index] !== b[index]) return a[index] > b[index];
	}
	return true;
};

test("keeps the Agents MCP peers aligned, patched and server-only", () => {
	assert.equal(manifest.dependencies.agents, agentsManifest.version);
	for (const name of [
		"@modelcontextprotocol/sdk",
		"@modelcontextprotocol/client",
		"@modelcontextprotocol/server",
	]) {
		assert.equal(
			manifest.dependencies[name],
			agentsManifest.peerDependencies[name],
			`${name} must match the exact peer agents@${agentsManifest.version} declares`,
		);
	}
	assert.ok(
		atLeast(manifest.dependencies["@modelcontextprotocol/sdk"], "1.31.0"),
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
			/@modelcontextprotocol\/sdk\/client|@modelcontextprotocol\/client|authProvider|withOAuth|fetchToken\(|\bauth\(/,
			`${path} entered the OAuth-client scope and needs a fresh security review`,
		);
	}

	for (const path of [
		"apps/icons/src/lib/mcp.server.ts",
		"apps/playground/src/server/codemode/mcp.server.ts",
	]) {
		const source = read(path);
		assert.match(source, /import\("agents\/mcp"\)/);
		assert.match(source, /createLegacyMcpHandler/);
	}
});
