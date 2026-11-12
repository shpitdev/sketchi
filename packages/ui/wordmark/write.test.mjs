import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { OUTPUT, render } from "./write.mjs";

test("the committed wordmark is what the strokes ink to", () => {
	assert.equal(
		readFileSync(OUTPUT, "utf8"),
		render(),
		"Re-ink with `pnpm nx run ui:wordmark` after changing the strokes or the pen.",
	);
});

test("the wordmark stays a small, single path", () => {
	const source = readFileSync(OUTPUT, "utf8");
	const path = /"(M[^"]+)"/u.exec(source)?.[1] ?? "";
	assert.equal(path.match(/M/gu)?.length, 1, "one absolute move; the rest are relative subpaths");
	assert.ok(Buffer.byteLength(path) < 5000, `${Buffer.byteLength(path)} bytes`);
});
