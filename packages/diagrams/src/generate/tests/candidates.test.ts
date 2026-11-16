import { describe, expect, it } from "vitest";

import {
	candidateFromText,
	type DiagramGenerationRequest,
	enforceCandidateRequestRequirements,
} from "../candidates.js";

const flowchart = (nodes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
	candidateFromText({
		model: "test",
		provider: "fixture",
		text: JSON.stringify({
			title: "Deploy pipeline",
			diagram: {
				id: "deploy",
				type: "flowchart",
				...extra,
				nodes,
				edges: [
					["push", "build"],
					["build", "ship"],
				],
			},
		}),
	});

const request = (
	prompt: Partial<DiagramGenerationRequest["prompt"]> = {},
): DiagramGenerationRequest => ({
	model: "test",
	prompt: { id: "deploy", request: "Push to GitHub, build with Docker, then ship.", ...prompt },
});

function nodeIcons(result: { readonly diagram?: unknown }) {
	const diagram = result.diagram as
		| { readonly type: string; readonly nodes: ReadonlyArray<{ readonly icon?: unknown }> }
		| undefined;
	if (diagram?.type !== "flowchart") throw new Error("Expected a flowchart.");
	return diagram.nodes.map((node) => node.icon);
}

describe("a generated candidate", () => {
	it("is held to the family a typed request names", () => {
		const parsed = flowchart({ push: "Push", build: "Build", ship: "Ship" });
		const typed = (requestedType: "flowchart" | "sequence") =>
			enforceCandidateRequestRequirements(parsed, request({ requestedType }));
		expect(typed("flowchart").diagram?.type).toBe("flowchart");
		expect(typed("sequence").diagram).toBeUndefined();
		expect(typed("sequence").error).toBeDefined();
	});

	it("refuses a repeated node id that JSON would silently keep once", () => {
		const text = `{"title":"Repeat","diagram":{"type":"flowchart","id":"repeat","nodes":{"a":"Start","b":"Review","b":"Ship"},"edges":[["a","b"]]}}`;
		const candidate = candidateFromText({ model: "test", provider: "fixture", text });
		expect(candidate.diagram).toBeUndefined();
		expect(candidate.diagnostics.join()).toContain("flowchart.duplicate_node_id");
	});
});

describe("generated logos", () => {
	const labelled = (icons: Record<string, string>) =>
		flowchart({
			push: { label: "Push to GitHub", icon: icons["push"] },
			build: { label: "Build the image", icon: icons["build"] },
			ship: { label: "Ship it", icon: icons["ship"] },
		});

	it.each([
		[
			"draws only logos the prompt offered",
			{ push: "github", build: "kubernetes", ship: "constructor" },
			[{ slug: "github", name: "GitHub" }],
		],
		[
			"draws a vendor logo only where the label names the vendor",
			{ push: "github", build: "kubernetes" },
			[
				{ slug: "github", name: "GitHub", collection: "devtools-ci" },
				{ slug: "kubernetes", name: "Kubernetes", aliases: ["k8s"], collection: "devtools-ci" },
			],
		],
	])("%s", (_name, icons, logos) => {
		const enforced = enforceCandidateRequestRequirements(labelled(icons), request({ logos }));
		expect(enforced.error).toBeUndefined();
		expect(nodeIcons(enforced)).toEqual([{ slug: "github" }, undefined, undefined]);
	});

	it("draws none when the prompt offered none", () => {
		const enforced = enforceCandidateRequestRequirements(
			labelled({ push: "github" }),
			request({ logos: [] }),
		);
		expect(nodeIcons(enforced).every((icon) => !icon)).toBe(true);
	});
});

describe("a flowchart revision written as edits", () => {
	const base = {
		type: "flowchart",
		id: "checkout",
		title: "Checkout",
		nodes: { cart: "Review cart", pay: "Take payment", done: "Confirm order" },
		edges: [
			["cart", "pay"],
			["pay", "done"],
		],
	};
	const revise = (edits: unknown) =>
		candidateFromText(
			{ model: "test", provider: "fixture", text: JSON.stringify({ edits }) },
			base,
		);

	it("applies the edits to the base", () => {
		const candidate = revise([
			{ op: "insert", node: { fraud: "Check for fraud" }, between: ["cart", "pay"] },
		]);
		expect(candidate.error).toBeUndefined();
		const drawn = candidate.diagram;
		expect(drawn?.type === "flowchart" && drawn.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining(["cart", "fraud", "pay", "done"]),
		);
		expect(candidate.flowchart?.edges).toContainEqual(["cart", "fraud"]);
		expect(candidate.flowchart?.edges).toContainEqual(["fraud", "pay"]);
	});

	it("sends an edit naming what the base lacks back for repair", () => {
		const candidate = revise([{ op: "insert", node: { x: "X" }, between: ["cart", "shipping"] }]);
		expect(candidate.diagram).toBeUndefined();
		expect(candidate.diagnostics.join()).toContain("flowchart.unknown_edit_target");
	});
});
