import { describe, expect, it } from "vitest";

import { nodeLogoIcons } from "../src/catalog";
import { GENERIC_PROMPTS } from "../src/generic-prompts";
import {
	labelLogos,
	logoNamedByLabel,
	logosNamedInText,
	matchIconsInText,
} from "../src/text-match";

/** Diagram labels and the logos they name, unmistakable names first. Empty: draw no logo. */
const LABELS: readonly (readonly [string, readonly string[]])[] = [
	["Ship to Cloudflare Workers", ["cloudflareworkers"]],
	["Upload to S3", ["amazon-s3"]],
	["Vercel-hosted Next.js page", ["nextjs", "vercel"]],
	["On Vercel, a Next.js page answers", ["nextjs", "vercel"]],
	["Postgres hosted by Supabase", ["postgresql", "supabase"]],
	["Supabase Postgres", ["supabase", "postgresql"]],
	["Cloudflare-hosted Edge function", ["cloudflare", "edge"]],
	["Node.js worker", ["nodejs"]],
	["Deploy to Fly.io", ["flyio"]],
	["Retry later, i.e. after a backoff", []],
	["Terraform applies the plan", ["terraform"]],
	["Go worker", ["go"]],
	["Next frontend", ["nextjs"]],
	["Linear API", ["linear"]],
	["Log errors to Sentry", ["sentry"]],
	// Everyday words that are also products read as steps.
	["Go to checkout", []],
	["Make payment", []],
	["React to incident", []],
	["Stripe payments", []],
	["Temporal data", []],
	["Square root", []],
	["Update the README", []],
	["Validate the JWT", []],
	["Square webhook", ["square"]],
	["ReadMe API docs", ["readme"]],
	["Temporal worker", ["temporal"]],
	// Google Cloud's everyday-word products stay steps; its distinctive ones are named.
	["Workflows", []],
	["Storage", []],
	["Storage service", []],
	["Cloud Run", ["cloud-run"]],
	["BigQuery", ["big-query"]],
	// Plain resource words stay concepts, never a cloud vendor's resource.
	["Database", []],
	["Queue worker", []],
	["Storage bucket", []],
	["Notebooks", []],
	["Virtual warehouse", []],
	["Lambda function", ["aws-lambda-function"]],
	["S3 bucket", ["amazon-s3-bucket"]],
	["AWS Glue job", ["aws-glue"]],
	// Payment steps stay clean.
	["Charge the card", []],
	["Sync the order to the warehouse", []],
	["Look up the user ID", []],
	// The brand's own mark, not a vendor's or a Foundry app's.
	["Kafka", ["apachekafka"]],
	["Argo CD", ["argo"]],
	["Cloudflare Workers AI", ["workersai"]],
	["Foundry Jupyter", ["code-workspace-jupyter-app"]],
	["Microsoft Teams", ["microsoft-teams"]],
	["Teams", []],
	["plaid shirt", []],
	["Plaid API", ["plaid"]],
	["dbt", []],
	["dbt models", ["dbt"]],
];

/** Prompts and the logos offered for them, in order of mention. */
const PROMPTS: readonly (readonly [string, readonly string[]])[] = [
	[
		"Diagram our deploy pipeline: push to GitHub, build with Docker, run tests, ship to Cloudflare Workers.",
		["github", "docker", "cloudflareworkers"],
	],
	["Run it on k8s.", ["kubernetes"]],
	["A Go service on Render writes tickets to Linear", ["go", "render", "linear"]],
	// Sentence starts, colon clauses, Title Case lines and all-caps words carry no signal.
	["Render it. Swift: delivery. Linear\nGo", []],
	["Deploy With Go\nGo Live", []],
	["look up the user ID and the SYNC status", []],
	["constructor toString __proto__ hasOwnProperty", []],
	[
		"Draw an AWS architecture with ALB and ECS services",
		["aws", "elastic-load-balancing-application-load-balancer", "amazon-ecs"],
	],
	["we use an alb for routing", []],
	["a VPC with IAM roles and KMS keys", []],
	["Notebooks run jobs in the workspace over a lakehouse with delta tables", []],
	["tables, views, stages, tasks and roles in the warehouse", []],
	["Use Amazon Managed Streaming for Apache Kafka in the diagram.", ["amazon-msk"]],
	["We store temporal data and zoom in on helm charts.", []],
	["Run Temporal workflows on Kubernetes with Helm.", ["temporal", "kubernetes", "helm"]],
	["Parse the YAML config and the XML payload.", []],
	["Draw an Excalidraw diagram of our checkout with Stripe.", ["stripe"]],
	["Convert this Mermaid flowchart and the draw.io export.", []],
	["Draw a UML class diagram of the order service.", []],
	["TanStack Query and Zustand on Linux", ["tanstack", "zustand", "linux"]],
];

describe("logos named in diagram text", () => {
	it("names the logos a label names, and none for steps", () => {
		for (const [label, slugs] of LABELS) {
			expect(
				labelLogos(label, nodeLogoIcons).named.map((icon) => icon.slug),
				label,
			).toEqual(slugs);
		}
		// One logo per node: several products in a label name none.
		expect(logoNamedByLabel("Docker image pushed to GitHub", nodeLogoIcons)).toBeUndefined();
	});

	it("offers the logos a prompt names, and none for prompts that name no technology", () => {
		for (const [prompt, slugs] of PROMPTS) {
			expect(
				logosNamedInText(prompt, nodeLogoIcons).map((logo) => logo.slug),
				prompt,
			).toEqual(slugs);
		}
		for (const prompt of GENERIC_PROMPTS) {
			expect(matchIconsInText(prompt, nodeLogoIcons), prompt).toEqual([]);
		}
		expect(
			matchIconsInText("GitHub to GitHub to Docker to Redis", nodeLogoIcons, 2).map(
				(icon) => icon.slug,
			),
		).toEqual(["github", "docker"]);
	});

	it("names a product the request writes only as its name wherever a label has the word", () => {
		const alwaysNamed = (text: string) =>
			new Set(
				logosNamedInText(text, nodeLogoIcons)
					.filter((logo) => logo.alwaysNamed)
					.map((logo) => logo.slug),
			);
		const named = (label: string, brands: ReadonlySet<string>) =>
			labelLogos(label, nodeLogoIcons, { alwaysNamed: brands }).named.map((icon) => icon.slug);
		const brands = alwaysNamed("Charge cards through Stripe and post each order to Slack.");
		expect(named("Stripe charge", brands)).toEqual(["stripe"]);
		expect(named("Stripe webhook to Slack", brands)).toEqual(["stripe", "slack"]);
		// A request that also writes the word plainly keeps its steps.
		const plain = alwaysNamed("Deploy the Go API to Render, then go live and render the page.");
		expect(named("Go live", plain)).toEqual([]);
		// A short product a request offers is named bare.
		const dbt = nodeLogoIcons.filter((icon) => icon.slug === "dbt");
		expect(labelLogos("Run dbt", dbt, { offered: true }).named.map((icon) => icon.slug)).toEqual([
			"dbt",
		]);
	});
});
