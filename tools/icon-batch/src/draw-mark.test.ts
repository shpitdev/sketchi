import { describe, expect, it } from "vitest";

import { drawName } from "./draw-mark.js";

describe("drawName", () => {
	it("keeps a name the draw input accepts", () => {
		expect(drawName("Amazon S3 Bucket")).toBe("Amazon S3 Bucket");
	});

	it("drops the vendor prefix, then words from the end, to fit", () => {
		expect(drawName("Amazon OpenSearch Service Cluster Administrator Node")).toBe(
			"OpenSearch Service Cluster Administrator Node",
		);
		expect(drawName("AWS Application Discovery Service Migration Evaluator Collector")).toBe(
			"Application Discovery Service Migration",
		);
	});
});
