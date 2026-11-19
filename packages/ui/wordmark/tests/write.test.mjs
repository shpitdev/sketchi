import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { OUTPUT, render } from "../write.mjs";

test("the committed wordmark is what the strokes ink to", () => {
	assert.equal(
		readFileSync(OUTPUT, "utf8"),
		render(),
		"Re-ink with `pnpm nx run ui:wordmark` after changing the strokes or the pen.",
	);
});

test("the wordmark path stays under 5000 bytes", () => {
	const source = readFileSync(OUTPUT, "utf8");
	const path = /WORDMARK_PATH\s*=\s*"([^"]+)"/u.exec(source)?.[1];
	assert.ok(path);
	assert.ok(Buffer.byteLength(path) < 5000, `${Buffer.byteLength(path)} bytes`);
});
