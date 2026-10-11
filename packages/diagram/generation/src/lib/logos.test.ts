import { describe, expect, it } from "vitest";

import {
	candidateFromText,
	enforceCandidateRequestRequirements,
	type DiagramGenerationRequest,
} from "./candidates";
import { buildDiagramGenerationMessages } from "./messages";

const logos = [
	{ slug: "github", name: "GitHub" },
	{ slug: "docker", name: "Docker" },
];

function request(
	prompt: Partial<DiagramGenerationRequest["prompt"]> = {},
): DiagramGenerationRequest {
	return {
		model: "gemini-test",
		prompt: {
			id: "deploy",
			request: "Push to GitHub, build with Docker, then ship.",
			logos,
			...prompt,
		},
	};
}

function responseText(icons: Record<string, unknown>) {
	const node = (id: string, label: string, kind: string) => ({
		id,
		label,
		kind,
		...(icons[id] === undefined ? {} : { icon: icons[id] }),
	});
	return JSON.stringify({
		title: "Deploy pipeline",
		intent: {
			requestedKind: "flowchart",
			nativeKind: "flowchart",
			requirements: [],
		},
		diagram: {
			id: "deploy",
			type: "flowchart",
			nodes: [
				node("push", "Push to GitHub", "start"),
				node("build", "Build the image", "process"),
				node("ship", "Ship it", "end"),
			],
			edges: [
				{ id: "a", source: "push", target: "build" },
				{ id: "b", source: "build", target: "ship" },
			],
			layout: { direction: "TB", edgeRouting: "orthogonal" },
		},
	});
}

function nodeIcons(result: { readonly diagram?: unknown }) {
	const diagram = result.diagram as
		| {
				readonly type: string;
				readonly nodes: ReadonlyArray<{ readonly icon?: unknown }>;
		  }
		| undefined;
	if (diagram?.type !== "flowchart") throw new Error("Expected a flowchart.");
	return diagram.nodes.map((node) => node.icon);
}

function candidate(icons: Record<string, unknown>) {
	return candidateFromText({
		model: "gemini-test",
		provider: "fixture",
		text: responseText(icons),
	});
}

describe("generation logo guidance", () => {
	it("lists only the prompt's logos for flowcharts and sequence diagrams", () => {
		const { user } = buildDiagramGenerationMessages(request().prompt);
		expect(user).toContain("Available logos:");
		expect(user).toContain("- github: GitHub\n- docker: Docker");
		expect(user).toContain("A flowchart node or sequence participant about one of these");
		expect(user).toContain("Never invent a slug.");

		const flowchart = buildDiagramGenerationMessages(
			request({ requestedType: "flowchart" }).prompt,
		);
		expect(flowchart.user).toContain("A flowchart node about one of these");
		expect(flowchart.user).not.toContain("participant");

		const sequence = buildDiagramGenerationMessages(request({ requestedType: "sequence" }).prompt);
		expect(sequence.user).toContain("A sequence participant about one of these");
		expect(sequence.user).toContain("Put each logo on the participant whose label names");
	});

	it("adds nothing when no logos apply or another family is required", () => {
		for (const prompt of [
			request({ logos: [] }).prompt,
			request({ requestedType: "mindmap" }).prompt,
		]) {
			expect(buildDiagramGenerationMessages(prompt).user).not.toContain("Available logos");
		}
	});
});

describe("generated node icons", () => {
	it("normalizes slug case and drops malformed icons without failing", () => {
		const result = candidate({
			push: { slug: "GitHub" },
			build: { slug: "Docker Logo" },
			ship: "cloudflare",
		});

		expect(result.error).toBeUndefined();
		expect(nodeIcons(result)).toEqual([{ slug: "github" }, undefined, undefined]);
		expect(result.diagnostics).toEqual([
			expect.stringContaining('icon_dropped: node "build"'),
			expect.stringContaining('icon_dropped: node "ship"'),
		]);
	});

	it("keeps only logos the prompt offered", () => {
		const enforced = enforceCandidateRequestRequirements(
			candidate({
				push: { slug: "github" },
				build: { slug: "kubernetes" },
				ship: { slug: "constructor" },
			}),
			request(),
		);

		expect(enforced.error).toBeUndefined();
		expect(nodeIcons(enforced)).toEqual([{ slug: "github" }, undefined, undefined]);
		expect(enforced.diagnostics).toEqual([
			expect.stringContaining('icon_not_in_prompt: node "build" icon "kubernetes"'),
			expect.stringContaining('icon_not_in_prompt: node "ship" icon "constructor"'),
		]);
	});

	it("drops every icon when the prompt offered no logos", () => {
		const enforced = enforceCandidateRequestRequirements(
			candidate({ push: { slug: "github" } }),
			request({ logos: [] }),
		);
		expect(nodeIcons(enforced).every((icon) => !icon)).toBe(true);
	});
});

function sequenceCandidate(icons: Record<string, unknown>) {
	const participant = (id: string, label: string) => ({
		id,
		label,
		...(icons[id] === undefined ? {} : { icon: icons[id] }),
	});
	return candidateFromText({
		model: "gemini-test",
		provider: "fixture",
		text: JSON.stringify({
			title: "Deploy",
			intent: { requestedKind: "sequence", nativeKind: "sequence", requirements: [] },
			diagram: {
				id: "deploy",
				type: "sequence",
				participants: [
					participant("dev", "Developer"),
					participant("repo", "GitHub repository"),
					participant("builder", "Docker builder"),
				],
				messages: [
					{ id: "push", source: "dev", target: "repo", label: "git push" },
					{ id: "build", source: "repo", target: "builder", label: "Build image" },
				],
			},
		}),
	});
}

function participantIcons(result: { readonly diagram?: unknown }) {
	const diagram = result.diagram as
		| {
				readonly type: string;
				readonly participants: ReadonlyArray<{ readonly icon?: unknown }>;
		  }
		| undefined;
	if (diagram?.type !== "sequence") throw new Error("Expected a sequence diagram.");
	return diagram.participants.map((participant) => participant.icon);
}

describe("generated sequence participant logos", () => {
	it("normalizes participant slugs and drops malformed ones without failing", () => {
		const result = sequenceCandidate({ repo: { slug: " GitHub " }, builder: "docker" });
		expect(result.error).toBeUndefined();
		expect(participantIcons(result)).toEqual([undefined, { slug: "github" }, undefined]);
		expect(result.diagnostics).toEqual([
			expect.stringContaining('icon_dropped: participant "builder"'),
		]);
	});

	it("places offered logos on the participants that name them and drops the rest", () => {
		const enforced = enforceCandidateRequestRequirements(
			sequenceCandidate({ dev: { slug: "docker" }, repo: { slug: "kubernetes" } }),
			request({ requestedType: "sequence" }),
		);
		expect(enforced.error).toBeUndefined();
		expect(participantIcons(enforced)).toEqual([undefined, { slug: "github" }, { slug: "docker" }]);
		expect(enforced.diagnostics).toEqual(
			expect.arrayContaining([
				expect.stringContaining(
					'icon_dropped: participant "dev" logo "docker" belongs to the participant whose label names it.',
				),
				expect.stringContaining('icon_placed: participant "repo" names github'),
			]),
		);
	});
});
