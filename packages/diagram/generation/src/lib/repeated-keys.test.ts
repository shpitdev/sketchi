import { describe, expect, it } from "vitest";

import { repeatedJsonKeys } from "./repeated-keys.js";

describe("repeated JSON keys", () => {
	it("names each key an object repeats, by its path", () => {
		const text = `Here it is:
{"title":"T","diagram":{"nodes":{"a":"Start","b":"Review","b":"Ship"},"edges":[["a","b"]],
"groups":{"g":{"label":"G","contains":["a"]},"g":{"label":"H","contains":["b"]}}}}`;
		expect(repeatedJsonKeys(text)).toEqual(["diagram.nodes.b", "diagram.groups.g"]);
	});

	it("reads keys in arrays, escapes and nested values, and repeats across objects are fine", () => {
		const text = JSON.stringify({
			diagram: {
				nodes: { 'a"b': "Quote", c: { label: "C", note: "x" } },
				edges: [{ a: 1 }, { a: 2 }],
			},
		});
		expect(repeatedJsonKeys(text)).toEqual([]);
		expect(repeatedJsonKeys('{"list":[{"k":1,"k":2}]}')).toEqual(["list[0].k"]);
		expect(repeatedJsonKeys('{"a":"\\u0062","a":true}')).toEqual(["a"]);
	});

	it("finds nothing in text without an object", () => {
		expect(repeatedJsonKeys("no json here")).toEqual([]);
	});
});
