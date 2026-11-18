// Real model outputs the graders once got wrong, kept as saved. Each grades as recorded through
// the same decoding the CLI applies to `--input`: a build or receipt, else bare IR.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The scenario fixture test reads the checked-in regression corpus directly.
import { readFileSync } from "node:fs";
import { Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { getDiagramScenario } from "../lib/diagram-scenarios";
import { evaluateScenarioDiagram } from "../lib/evaluate";
import { candidateFromMcpResult } from "../lib/mcp-results";

const load = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function failedChecks(scenarioId: string, input: unknown): string[] {
	const scenario = getDiagramScenario(scenarioId);
	const decoded = candidateFromMcpResult(input, scenario.diagramType).pipe(
		Result.getOrThrow,
		Option.getOrUndefined,
	);
	if (decoded && !decoded.ok) return [decoded.check.id];
	return evaluateScenarioDiagram(scenario, decoded ? decoded.diagram : input)
		.pipe(Result.getOrThrow)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

const accepted = (normalizedSpec: unknown) => ({ ok: true, status: "accepted", normalizedSpec });

type Sample = { readonly runId?: string; readonly sample?: number; readonly id?: string };
/** Exactly these checks fail, or (for an output with unrelated defects) one fails and one passes. */
type Outcome = readonly string[] | { readonly fails: string; readonly passes: string };
type Row = readonly [label: string, scenarioId: string, input: unknown, outcome: Outcome];

function rows<S extends object>(
	fixture: string,
	scenarioId: string,
	input: (sample: S) => unknown,
	outcome: (sample: S, index: number) => Outcome = () => [],
): Row[] {
	return (load(fixture) as S[]).map((sample, index) => [
		`${fixture} ${(sample as Sample).runId ?? (sample as Sample).id ?? index + 1}`,
		scenarioId,
		input(sample),
		outcome(sample, index),
	]);
}

const appStack = "ai-app-stack-logos";

const entryStep = "node-label:Request reaches Vercel → Next.js page receives question";
const OWNER_DEFECTS: Readonly<Record<string, string>> = {
	iseo: "node-label:Return cached answer",
	ijyw: "icon:nextjs",
	exa3: "icons-on-named-steps",
	hk69: "edge:Store answer in Redis->Log errors to Sentry",
};

const recorded: readonly Row[] = [
	// Oct 29 receipts: the Vercel/Next.js entry drawn as one, two or a chained start.
	...rows<{ spec: unknown }>("app-stack-entries", appStack, ({ spec }) => accepted(spec)),
	// Entries owned after a bare start: the entry matches; each keeps its own real defect.
	...rows<{ runId: string; spec: unknown }>(
		"app-stack-entry-owners",
		appStack,
		({ spec }) => accepted(spec),
		({ runId }) => ({ fails: OWNER_DEFECTS[runId.slice(-4)]!, passes: entryStep }),
	),
	// Oct 30 receipts: Vercel drawn as a group around the page, its logo filled from the label.
	// 3gb7 (Oct 23) drew the same group before groups drew logos.
	...rows<{ runId: string; receipt: unknown }>(
		"app-stack-host-groups",
		appStack,
		({ receipt }) => receipt,
		({ runId }) => (runId.endsWith("3gb7") ? ["icon:vercel"] : []),
	),
	// The cached answer folded onto the hit branch into the shared answer.
	...rows<{ spec: unknown }>("cached-answer-folds", appStack, ({ spec }) => accepted(spec)),
	// Payment drawn as its own terminal after director approval.
	...rows<{ spec: unknown }>("payment-terminals", "invoice-approval", ({ spec }) => accepted(spec)),
	// External services wrapped outside the cluster.
	...rows<{ spec: unknown }>("outside-cluster", "kubernetes-cluster-zones-v2", ({ spec }) =>
		accepted(spec),
	),
	// Stated group membership, from the Sonnet-fidelity replays.
	...rows<{ spec: unknown }>("group-members-replays", "grouped-expense-approval-v2", ({ spec }) =>
		accepted(spec),
	),
	// Round 16 waitlist: the wait step on a labeled loop-back; sample 2 never names it.
	...rows<{ sample: number; spec: object }>(
		"round16-restaurant-waitlist",
		"restaurant-waitlist",
		({ spec }) => ({ ...spec, type: "flowchart" }),
		({ sample }) =>
			sample === 2
				? [
						"node-label:Keep waiting",
						"edge:Table ready?->Keep waiting:no",
						"edge:Keep waiting->Party responds?",
					]
				: [],
	),
	// Lunar descriptions folded into event labels; the fifth sample drops one.
	...rows<object>(
		"timeline-descriptions",
		"lunar-mission-timeline-v2",
		(spec) => accepted(spec),
		(_, index) => (index === 4 ? ["timeline-event:7"] : []),
	),
	["chart-cloud-spend-7sp6", "cloud-spend-pie-chart", accepted(load("chart-cloud-spend-7sp6")), []],
	[
		"wireframe-sidebar-title-k5ci",
		"saas-dashboard-wireframe",
		accepted(load("wireframe-sidebar-title-k5ci")),
		[],
	],
	[
		"wireframe-header-links-gsf2",
		"product-page-wireframe",
		accepted(load("wireframe-header-links-gsf2")),
		[],
	],
	[
		"wireframe-kpi-cards-child-titles",
		"saas-dashboard-wireframe",
		accepted(load("wireframe-kpi-cards-child-titles")),
		[],
	],
	// Links the prompt puts at the screen's bottom, drawn mid-screen in the flow.
	[
		"wireframe-login-bottom-in-flow",
		"mobile-login-wireframe",
		accepted(load("wireframe-login-bottom-in-flow")),
		["side:login-bottom"],
	],
];

describe("real model outputs", () => {
	it.each(recorded)("grade %s as recorded", (_label, scenarioId, input, outcome) => {
		const failed = failedChecks(scenarioId, input);
		if ("fails" in outcome) {
			expect(failed).toContain(outcome.fails);
			expect(failed).not.toContain(outcome.passes);
		} else expect(failed).toEqual(outcome);
	});
});
