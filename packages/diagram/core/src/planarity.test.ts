import { describe, expect, it } from "vitest";
import { unavoidableCrossings } from "./planarity";

const graph = (pairs: string) =>
	pairs.split(" ").map((pair) => pair.split("-") as [string, string]);

describe("unavoidable crossings", () => {
	it("finds none in planar graphs, however they are given", () => {
		for (const pairs of [
			"a-b",
			"a-b b-c c-a",
			"a-b a-c a-d b-c b-d c-d",
			"1-2 2-3 3-4 4-1 5-6 6-7 7-8 8-5 1-5 2-6 3-7 4-8",
			"a-b b-c d-e e-f g-h h-i a-d b-e c-f d-g e-h f-i",
			// A loop, a repeat and an edge both ways change nothing.
			"a-a a-b b-a a-b b-c",
		])
			expect(unavoidableCrossings(graph(pairs))).toBe(0);
	});

	it("finds at least one in K5, K3,3 and the Petersen graph", () => {
		expect(unavoidableCrossings(graph("a-b a-c a-d a-e b-c b-d b-e c-d c-e d-e"))).toBe(1);
		expect(unavoidableCrossings(graph("a-x a-y a-z b-x b-y b-z c-x c-y c-z"))).toBe(1);
		expect(
			unavoidableCrossings(graph("0-1 1-2 2-3 3-4 4-0 0-5 1-6 2-7 3-8 4-9 5-7 7-9 9-6 6-8 8-5")),
		).toBe(1);
	});

	it("counts each nonplanar block, and edges past a plane graph's", () => {
		// Two K5s joined at one node: two blocks, one crossing each.
		const k5 = (prefix: string, shared: string) =>
			graph(
				"a-b a-c a-d a-e b-c b-d b-e c-d c-e d-e".replaceAll(/[a-e]/g, (node) =>
					node === "a" ? shared : `${prefix}${node}`,
				),
			);
		expect(unavoidableCrossings([...k5("p", "hub"), ...k5("q", "hub")])).toBe(2);
		// K6: 15 edges where a plane graph of six nodes holds 12.
		const nodes = ["a", "b", "c", "d", "e", "f"];
		const k6 = nodes.flatMap((a, index) => nodes.slice(index + 1).map((b) => [a, b] as const));
		expect(unavoidableCrossings(k6)).toBe(3);
	});

	it("finds K3,3 subdivided inside a flowchart: three checks that each lead to two ends", () => {
		const pairs = graph(
			"classify-r1 classify-r2 classify-r3 r1-s1 r2-s2 r3-s3 s1-monitor s1-escalate s2-monitor s2-escalate s3-monitor s3-escalate escalate-collect collect-classify",
		);
		expect(unavoidableCrossings(pairs)).toBe(1);
	});
});
