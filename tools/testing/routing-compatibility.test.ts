import { describe, expect, it } from "vitest";
import { normalizeRoutingAgainstFrozen } from "./routing-compatibility.mjs";

describe("routing receipt migration", () => {
	const arrow = {
		type: "arrow",
		id: "edge:yes",
		sourceNodeId: "decision",
		targetNodeId: "done",
		label: "Yes",
		points: [
			{ x: 0, y: 0 },
			{ x: 0, y: 100 },
		],
	};
	const frozen = { elements: [arrow] };
	const current = {
		elements: [
			{
				...arrow,
				label: undefined,
				points: [
					{ x: 10, y: 0 },
					{ x: 10, y: 100 },
				],
				groupIds: ["branch:yes"],
			},
			{ type: "text", id: "edge:yes:label", text: "Yes", x: 20, y: 20 },
		],
	};
	it("normalizes intentional routing geometry and explicit labels", () =>
		expect(normalizeRoutingAgainstFrozen(current, frozen)).toEqual(frozen));
	it("does not mask changed endpoints or labels", () => {
		expect(
			normalizeRoutingAgainstFrozen(
				{
					...current,
					elements: [{ ...current.elements[0], targetNodeId: "wrong" }, current.elements[1]],
				},
				frozen,
			),
		).not.toEqual(frozen);
		expect(
			normalizeRoutingAgainstFrozen(
				{ ...current, elements: [current.elements[0], { ...current.elements[1], text: "No" }] },
				frozen,
			),
		).not.toEqual(frozen);
	});
	it("preserves unrelated protocol and element changes", () => {
		expect(
			normalizeRoutingAgainstFrozen(
				{ status: "failed", elements: [...current.elements, { type: "node", id: "unexpected" }] },
				{ status: "accepted", ...frozen },
			),
		).not.toEqual({ status: "accepted", ...frozen });
	});
});
