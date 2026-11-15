import { logosNamedInText } from "@sketchi/icon-catalog";
import { nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
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

function responseText(icons: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const node = (id: string, label: string) =>
		icons[id] === undefined ? label : { label, icon: icons[id] };
	return JSON.stringify({
		title: "Deploy pipeline",
		diagram: {
			id: "deploy",
			type: "flowchart",
			...extra,
			nodes: {
				push: node("push", "Push to GitHub"),
				build: node("build", "Build the image"),
				ship: node("ship", "Ship it"),
			},
			edges: [
				["push", "build"],
				["build", "ship"],
			],
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

function candidate(icons: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	return candidateFromText({
		model: "gemini-test",
		provider: "fixture",
		text: responseText(icons, extra),
	});
}

describe("generation logo guidance", () => {
	it("lists only the prompt's logos for flowcharts and sequence diagrams", () => {
		const { user } = buildDiagramGenerationMessages(request().prompt);
		expect(user).toContain("Available logos:");
		expect(user).toContain("- github: GitHub\n- docker: Docker");
		expect(user).toContain('In a flowchart, set "logos": true');
		expect(user).toContain("A sequence participant about one of these");
		expect(user).toContain("Never invent a slug.");

		const flowchart = buildDiagramGenerationMessages(
			request({ requestedType: "flowchart" }).prompt,
		);
		expect(flowchart.user).toContain(
			'In a flowchart, set "logos": true and keep each technology\'s name in the label of the node or group about it',
		);
		expect(flowchart.user).not.toContain("participant");

		const sequence = buildDiagramGenerationMessages(request({ requestedType: "sequence" }).prompt);
		expect(sequence.user).toContain("A sequence participant about one of these");
		expect(sequence.user).not.toContain("In a flowchart");
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
	it("draws an icon a node names by slug or name, and leaves the rest to grounding", () => {
		const result = candidate({ push: "GitHub", build: "Docker Logo" });

		expect(result.error).toBeUndefined();
		expect(nodeIcons(result)).toEqual([{ slug: "github" }, undefined, undefined]);
	});

	it("keeps only logos the prompt offered", () => {
		const enforced = enforceCandidateRequestRequirements(
			candidate({ push: "github", build: "kubernetes", ship: "constructor" }),
			request(),
		);

		expect(enforced.error).toBeUndefined();
		expect(nodeIcons(enforced)).toEqual([{ slug: "github" }, undefined, undefined]);
		expect(enforced.flowchart?.nodes).toEqual({
			push: { label: "Push to GitHub", icon: "github" },
			build: "Build the image",
			ship: "Ship it",
		});
		expect(enforced.diagnostics).toEqual([
			expect.stringContaining('icon_not_in_prompt: node "build" icon "kubernetes"'),
			expect.stringContaining('icon_not_in_prompt: node "ship" icon "constructor"'),
		]);
	});

	it("drops a vendor logo from a node whose label does not name the vendor", () => {
		const enforced = enforceCandidateRequestRequirements(
			candidate({ push: "github", build: "kubernetes" }),
			request({
				logos: [
					{ slug: "github", name: "GitHub", collection: "devtools-ci" },
					{ slug: "kubernetes", name: "Kubernetes", aliases: ["k8s"], collection: "devtools-ci" },
				],
			}),
		);

		expect(enforced.error).toBeUndefined();
		expect(nodeIcons(enforced)).toEqual([{ slug: "github" }, undefined, undefined]);
		expect(enforced.diagnostics).toEqual([
			'icon_dropped: node "build" logo "kubernetes" is not named by its label "Build the image".',
		]);
	});

	it("drops every icon when the prompt offered no logos", () => {
		const enforced = enforceCandidateRequestRequirements(
			candidate({ push: "github" }),
			request({ logos: [] }),
		);
		expect(nodeIcons(enforced).every((icon) => !icon)).toBe(true);
	});

	it("with logos on, draws each offered logo a label names and sets every other node to none", () => {
		const enforced = enforceCandidateRequestRequirements(candidate({}, { logos: true }), request());

		expect(nodeIcons(enforced)).toEqual([{ slug: "github" }, undefined, undefined]);
		expect(enforced.flowchart).toMatchObject({
			logos: true,
			nodes: {
				push: { label: "Push to GitHub", icon: "github" },
				build: { label: "Build the image", icon: null },
				ship: { label: "Ship it", icon: null },
			},
		});
	});
});

/**
 * The logo each node draws once a logos-on flowchart for this request is grounded in the logos
 * the request offers, as /api/v1/generate grounds it; null draws none.
 */
function groundedLogos(text: string, labels: Record<string, string>) {
	const ids = Object.keys(labels);
	const enforced = enforceCandidateRequestRequirements(
		candidateFromText({
			model: "gemini-test",
			provider: "fixture",
			text: JSON.stringify({
				title: "Flow",
				diagram: {
					id: "flow",
					type: "flowchart",
					logos: true,
					nodes: labels,
					edges: ids.slice(1).map((id, index) => [ids[index], id]),
				},
			}),
		}),
		{
			model: "gemini-test",
			prompt: { id: "flow", request: text, logos: logosNamedInText(text, nodeLogoIcons) },
		},
	);
	if (!enforced.flowchart) throw new Error("Expected a flowchart document.");
	return Object.fromEntries(
		Object.entries(enforced.flowchart.nodes).map(([id, node]) => [
			id,
			typeof node === "string" ? undefined : node.icon,
		]),
	);
}

describe("logos for products named by everyday words", () => {
	it("draws each offered brand on the labels that name it, wherever the word stands", () => {
		expect(
			groundedLogos(
				"Flowchart of our checkout: a Next.js storefront on Vercel signs shoppers in with Clerk, charges cards through Stripe, emails receipts with Resend, posts each order to Slack, and reports failures to Sentry.",
				{
					storefront: "Next.js storefront",
					hosting: "Vercel",
					auth: "Clerk sign-in",
					charge: "Stripe charge",
					receipt: "Resend receipt email",
					order: "Slack order post",
					failure: "Sentry failure report",
				},
			),
		).toEqual({
			storefront: "nextjs",
			hosting: "vercel",
			auth: "clerk",
			charge: "stripe",
			receipt: "resend",
			order: "slack",
			failure: "sentry",
		});
		expect(
			groundedLogos(
				"Draw the analytics architecture: a React dashboard calls a Cloudflare Worker API, which reads cached metrics from Redis and falls back to querying Snowflake. Nightly, a GitHub Actions job loads Postgres exports into Snowflake.",
				{
					dashboard: "React dashboard",
					worker: "Cloudflare Worker API",
					cache: "Redis cached metrics",
					query: "Query Snowflake",
					job: "GitHub Actions nightly job",
					exports: "Postgres exports",
					load: "Load into Snowflake",
				},
			),
		).toEqual({
			dashboard: "react",
			worker: "cloudflareworkers",
			cache: "redis",
			query: "snowflake",
			job: "githubactions",
			exports: "postgresql",
			load: "snowflake",
		});
		expect(
			groundedLogos(
				"Incident flow: Sentry raises an alert, the on-call engineer is paged in Slack, they open a Linear ticket, deploy a fix to Vercel, and Stripe refunds affected customers.",
				{
					page: "Slack pages on-call engineer",
					ticket: "Open Linear ticket",
					deploy: "Deploy fix to Vercel",
					refund: "Stripe refunds affected customers",
					close: "Close incident",
				},
			),
		).toEqual({
			page: "slack",
			ticket: "linear",
			deploy: "vercel",
			refund: "stripe",
			close: null,
		});
	});

	it("keeps a step an everyday word starts when the request also writes the word plainly", () => {
		const labels = {
			live: "Go live",
			page: "Render page",
			pay: "Make payment",
			build: "Compile Go binary",
		};
		expect(
			groundedLogos(
				"Build the API in Go, deploy it to Render, and sync leads through Make. After review we go live, render the page, and make a payment.",
				labels,
			),
		).toEqual({ live: null, page: null, pay: null, build: "go" });
		// A sentence's first word may be the verb too.
		expect(
			groundedLogos(
				"Build the API in Go and deploy it to Render. Go live after review. Render the page and verify it.",
				{ live: "Go live", page: "Render page", build: "Compile Go binary" },
			),
		).toEqual({ live: null, page: null, build: "go" });
		expect(
			groundedLogos("Build the API in Go, deploy it to Render, and sync leads through Make.", {
				build: "Go build",
				deploy: "Render deploy",
				sync: "Make sync",
			}),
		).toEqual({ build: "go", deploy: "render", sync: "make" });
	});
});

describe("logos for short names that free text needs qualified", () => {
	it("draws dbt on a bare dbt label once the request names dbt models", () => {
		const request =
			"Diagram the warehouse pipeline: Fivetran syncs Postgres into BigQuery, dbt models clean the tables, and Looker reads them.";
		expect(
			groundedLogos(request, {
				sync: "Fivetran",
				transform: "dbt",
				job: "dbt nightly run",
				read: "Looker",
			}),
		).toEqual({ sync: "fivetran", transform: "dbt", job: "dbt", read: "looker" });
	});

	it("offers no dbt logo when the request never names the product", () => {
		expect(
			groundedLogos(
				"Flowchart of the clinic intake: assess the patient, then start DBT sessions.",
				{
					assess: "Assess patient",
					therapy: "DBT",
				},
			),
		).toEqual({ assess: null, therapy: null });
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
