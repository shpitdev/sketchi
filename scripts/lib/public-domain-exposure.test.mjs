import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { productionProjectConfig } from "./deploy/production.mjs";

const repoRoot = new URL("../../", import.meta.url);

test("the approved public-domain map is exact and internal apps stay private", () => {
	const expectedDomains = {
		excalidraw: [],
		"eval-harness": [],
		icons: ["icons.sketchi.app"],
		playground: ["playground.sketchi.app"],
		web: ["sketchi.app", "www.sketchi.app"],
	};

	for (const [projectId, domainPatterns] of Object.entries(expectedDomains)) {
		assert.deepEqual(productionProjectConfig(projectId).domainPatterns, domainPatterns);
	}

	assert.equal(productionProjectConfig("excalidraw").publicSurface, false);
	assert.equal(productionProjectConfig("eval-harness").publicSurface, false);
	assert.equal(productionProjectConfig("playground").publicSurface, true);
});

test("checked-in Wrangler configs never expose production custom domains", () => {
	for (const projectId of ["eval-harness", "excalidraw", "icons", "playground", "web"]) {
		const configPath = new URL(`apps/${projectId}/wrangler.jsonc`, repoRoot);
		const config = readFileSync(configPath, "utf8");
		assert.doesNotMatch(config, /(?:excalidraw|icons|playground|studio|www)\.sketchi\.app/);
		assert.doesNotMatch(config, /"(?:route|routes|custom_domain|domains)"\s*:/);
	}
});
