import { Result } from "effect";
import { parseFlowchartDiagram, flowchartDiagramType } from "../document";

export const flowchartFixture = parseFlowchartDiagram({
	id: "onboarding-flow",
	title: "Sketchi onboarding decision flow",
	type: flowchartDiagramType,
	nodes: [
		{ id: "prompt", label: "Prompt received", kind: "start" },
		{ id: "requirements", label: "Extract requirements", kind: "process" },
		{ id: "clear", label: "Scope clear?", kind: "decision" },
		{ id: "draft", label: "Draft typed IR", kind: "process" },
		{ id: "review", label: "Review diagram", kind: "end" },
	],
	edges: [
		{ id: "prompt-requirements", source: "prompt", target: "requirements" },
		{ id: "requirements-clear", source: "requirements", target: "clear" },
		{ id: "clear-draft", source: "clear", target: "draft", label: "yes" },
		{
			id: "clear-review",
			source: "clear",
			target: "review",
			label: "no",
		},
		{ id: "draft-review", source: "draft", target: "review" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
}).pipe(Result.getOrThrow);

export const pharmaBatchDispositionFlowchart = parseFlowchartDiagram({
	id: "pharma-batch-disposition",
	title: "Pharma batch disposition flow",
	type: flowchartDiagramType,
	nodes: [
		{ id: "batch-received", label: "Batch received", kind: "start" },
		{
			id: "qa-review",
			label: "QA reviews Certificate of Analysis",
			kind: "process",
		},
		{ id: "passes-specs", label: "Passes specs?", kind: "decision" },
		{ id: "final-review", label: "QA Manager final review", kind: "process" },
		{ id: "packaging", label: "Send to packaging", kind: "end" },
		{ id: "investigate", label: "Investigate retesting", kind: "process" },
		{ id: "reject", label: "Reject batch", kind: "end" },
	],
	edges: [
		{ id: "batch-qa", source: "batch-received", target: "qa-review" },
		{ id: "qa-specs", source: "qa-review", target: "passes-specs" },
		{
			id: "specs-pass",
			source: "passes-specs",
			target: "final-review",
			label: "yes",
		},
		{
			id: "specs-investigate",
			source: "passes-specs",
			target: "investigate",
			label: "retest",
		},
		{
			id: "specs-reject",
			source: "passes-specs",
			target: "reject",
			label: "reject",
		},
		{ id: "review-packaging", source: "final-review", target: "packaging" },
		{ id: "investigate-review", source: "investigate", target: "final-review" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
}).pipe(Result.getOrThrow);

/** A deploy flow whose nodes carry catalog logos, like the marketing hero. */
export const deployPipelineLogoFlowchart = parseFlowchartDiagram({
	id: "deploy-pipeline-logos",
	title: "Deploy pipeline",
	type: flowchartDiagramType,
	nodes: [
		{
			id: "push",
			label: "Push to GitHub",
			kind: "start",
			icon: { slug: "github" },
		},
		{
			id: "build",
			label: "Build the Docker image",
			kind: "process",
			icon: { slug: "docker" },
		},
		{
			id: "tests",
			label: "Tests pass?",
			kind: "decision",
			icon: { slug: "vitest" },
		},
		{ id: "fix", label: "Fix the failing tests", kind: "process" },
		{
			id: "ship",
			label: "Ship to Cloudflare Workers",
			kind: "end",
			icon: { slug: "cloudflare" },
		},
	],
	edges: [
		{ id: "push-build", source: "push", target: "build" },
		{ id: "build-tests", source: "build", target: "tests" },
		{ id: "tests-ship", source: "tests", target: "ship", label: "yes" },
		{ id: "tests-fix", source: "tests", target: "fix", label: "no" },
		{ id: "fix-build", source: "fix", target: "build" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
}).pipe(Result.getOrThrow);

/**
 * A request flow whose Vercel group draws its platform's logo before its name,
 * among node logos (Frontierclimb r23 ai-app-stack-logos s4).
 */
export const requestFlowGroupLogoFlowchart = parseFlowchartDiagram({
	id: "request-flow-group-logo",
	title: "Request flow",
	type: flowchartDiagramType,
	groups: [{ id: "vercel", label: "Vercel", icon: { slug: "vercel" } }],
	nodes: [
		{
			id: "page",
			label: "Next.js page receives the question",
			kind: "start",
			icon: { slug: "nextjs" },
			group: "vercel",
		},
		{
			id: "check",
			label: "Check Redis cache",
			kind: "process",
			icon: { slug: "redis" },
			group: "vercel",
		},
		{ id: "hit", label: "Cache hit?", kind: "decision", group: "vercel" },
		{ id: "call", label: "Call OpenAI model", kind: "process", icon: { slug: "openai" } },
		{ id: "store", label: "Store answer in Redis", kind: "process", icon: { slug: "redis" } },
		{ id: "log", label: "Log any errors to Sentry", kind: "process", icon: { slug: "sentry" } },
		{ id: "ret", label: "Return the answer", kind: "end" },
		{ id: "cached", label: "Return cached answer", kind: "end" },
	],
	edges: [
		{ id: "page-check", source: "page", target: "check" },
		{ id: "check-hit", source: "check", target: "hit" },
		{ id: "hit-cached", source: "hit", target: "cached", label: "yes" },
		{ id: "hit-call", source: "hit", target: "call", label: "no" },
		{ id: "call-store", source: "call", target: "store" },
		{ id: "store-log", source: "store", target: "log" },
		{ id: "log-ret", source: "log", target: "ret" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
}).pipe(Result.getOrThrow);

export const flowchartEvaluationFixtures = [flowchartFixture, pharmaBatchDispositionFlowchart];
