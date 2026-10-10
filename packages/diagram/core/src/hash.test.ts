import { describe, expect, it } from "vitest";

import { fnv1a32 } from "./hash";

describe("deterministic FNV identities", () => {
	it("preserves checksum and signed-hash seed representations", () => {
		expect(fnv1a32("", "hex")).toBe("811c9dc5");
		expect(fnv1a32("", "seed")).toBe(2166136261);
		expect(fnv1a32("hello", "hex")).toBe("4f9f2cab");
		expect(fnv1a32("hello", "seed")).toBe(1335831723);
	});

	it("preserves the existing character and library UTF-16 traversal contracts", () => {
		expect(fnv1a32("😀", "hex")).toBe("37822568");
		expect(fnv1a32("😀", "seed")).toBe(931276136);
		expect(fnv1a32("😀", "hex", "utf16")).toBe("cb31c4b8");
	});
});
