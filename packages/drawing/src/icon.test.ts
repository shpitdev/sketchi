import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DiagramIconRef } from "./icon.js";

describe("diagram icon references", () => {
	it("accepts catalog and community names and rejects malformed or foreign namespaces", () => {
		const accepts = Schema.is(DiagramIconRef);
		for (const slug of ["docker", "github", "community/ring-queue"]) {
			expect(accepts({ slug }), slug).toBe(true);
		}
		for (const slug of [
			"Docker",
			"docker logo",
			"",
			"-docker",
			"a".repeat(65),
			"community/",
			"community/a/b",
			`community/${"a".repeat(65)}`,
			"other/docker",
		]) {
			expect(accepts({ slug }), slug).toBe(false);
		}
	});
});
