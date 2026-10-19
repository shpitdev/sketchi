import { describe, expect, it } from "vitest";

import type { FlowchartNodeKind } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { getFlowchartScenario } from "./scenarios";

type NodeSpec = readonly [id: string, kind: FlowchartNodeKind, label: string, icon?: string];
type EdgeSpec = readonly [source: string, target: string, label?: string | undefined];

/** A synthetic model diagram for a scenario, shaped like observed generations. */
function flow(scenarioId: string, nodes: readonly NodeSpec[], edges: readonly EdgeSpec[]) {
	const scenario = getFlowchartScenario(scenarioId);
	const diagram = {
		...scenario.expectedDiagram,
		nodes: nodes.map(([id, kind, label, icon]) => ({
			id,
			kind,
			label,
			...(icon ? { icon: { slug: icon } } : {}),
		})),
		edges: edges.map(([source, target, label], index) => ({
			id: `e${index}`,
			source,
			target,
			...(label ? { label } : {}),
		})),
	};
	return evaluateScenarioDiagram(scenario, diagram);
}

function failed(result: ReturnType<typeof flow>): string[] {
	return result.checks.filter((check) => !check.passed).map((check) => check.id);
}

describe("action paraphrases with objects in for-clauses", () => {
	it.each([
		["feature-flag-rollout", "enable-internal", "Enable flag for internal users"],
		["feature-flag-rollout", "enable-beta", "Enable flag for beta cohort"],
		["feature-flag-rollout", "ramp-all", "Ramp up for all users"],
		["patient-intake-scheduling", "collect-info", "Collect information for intake"],
		["password-reset-security", "send-email", "Send email for password reset"],
		["customer-offboarding-retention", "close-account", "Close account (not eligible for offer)"],
	])("preserves all checks in %s: %s labeled %s", (id, nodeId, label) => {
		const scenario = getFlowchartScenario(id);
		const result = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === nodeId ? { ...node, label } : node,
			),
		});
		expect(result.checks.filter((check) => !check.passed)).toEqual([]);
	});
});

const PASSWORD_RESET_NODES: readonly NodeSpec[] = [
	["requested", "start", "A reset is requested"],
	["account", "decision", "Does the account exist?"],
	["generic", "end", "Show a generic response"],
	["email", "process", "Send the reset email"],
	["wait", "process", "Wait for the link click"],
	["clicked", "decision", "Is the link clicked?"],
	["expire", "end", "Expire the token"],
	["risk-check", "process", "Run a risk check"],
	["risk", "decision", "Risk level?"],
	["step-up", "process", "Step-up verification"],
	["reset", "end", "Reset the password"],
];

function passwordResetEdges(high: string, low: string): EdgeSpec[] {
	return [
		["requested", "account"],
		["account", "generic", "No"],
		["account", "email", "Yes"],
		["email", "wait"],
		["wait", "clicked"],
		["clicked", "expire", "No — timeout"],
		["clicked", "risk-check", "Yes"],
		["risk-check", "risk"],
		["risk", "step-up", high],
		["risk", "reset", low],
		["step-up", "reset"],
	];
}

const WAREHOUSE_HEAD: readonly NodeSpec[] = [
	["updated", "start", "Stock count is updated"],
	["below", "decision", "Is inventory below the reorder point?"],
	["monitor", "end", "Monitor stock"],
];

function warehouseMerged(available: string, unavailable: string) {
	return flow(
		"warehouse-reorder",
		[
			...WAREHOUSE_HEAD,
			["check", "decision", "Check supplier availability"],
			["substitute", "process", "Use a substitute supplier"],
			["order", "process", "Create a purchase order"],
			["delivery", "end", "Await delivery"],
		],
		[
			["updated", "below"],
			["below", "monitor", "No"],
			["below", "check", "Yes"],
			["check", "order", available],
			["check", "substitute", unavailable],
			["substitute", "order"],
			["order", "delivery"],
		],
	);
}

const REPO_STAGES: readonly NodeSpec[] = [
	["request", "start", "App submits a request"],
	["agent", "process", "Agent processes the app request"],
	["core", "process", "Core diagram model represents the diagram"],
	["renderer", "process", "Renderer renders the core diagram model"],
	["export", "process", "Excalidraw export produces the diagram artifact"],
	["response", "end", "Return the hosted artifact response"],
];

const AI_APP_TAIL: readonly NodeSpec[] = [
	["check", "process", "Check the Redis cache", "redis"],
	["cache", "decision", "Cache hit?"],
	["cached", "end", "Return the cached answer"],
	["model", "process", "Call the OpenAI model", "openai"],
	["store", "process", "Store the answer in Redis", "redis"],
	["log", "process", "Log any errors to Sentry", "sentry"],
	["answer", "end", "Return the answer"],
];

function aiAppTailEdges(entry: string, hit: string, miss: string): EdgeSpec[] {
	return [
		[entry, "check"],
		["check", "cache"],
		["cache", "cached", hit],
		["cache", "model", miss],
		["model", "store"],
		["store", "log"],
		["log", "answer"],
	];
}

const INCIDENT_ESCALATION_NODES: readonly NodeSpec[] = [
	["alert", "start", "Monitoring creates an alert"],
	["ack", "process", "Responder acknowledges it"],
	["severity", "decision", "Severity?"],
	["bridge", "process", "Incident bridge"],
	["mitigate", "process", "Mitigate impact"],
	["comms", "process", "Send customer communications"],
	["queue", "process", "Triage queue"],
	["fix", "decision", "Is there a fix?"],
	["monitoring", "process", "Monitoring"],
	["resolved", "end", "Resolved"],
];

function incidentEscalationEdges(monitoringBranch: string): EdgeSpec[] {
	return [
		["alert", "ack"],
		["ack", "severity"],
		["severity", "bridge", "High"],
		["severity", "queue", monitoringBranch === "Medium" ? "Low" : "Medium"],
		["severity", "monitoring", monitoringBranch],
		["bridge", "mitigate"],
		["mitigate", "comms"],
		["comms", "resolved"],
		["queue", "fix"],
		["fix", "resolved", "Yes"],
		["fix", "bridge", "No"],
		["monitoring", "resolved"],
	];
}

function patientIntake(routine: string) {
	return flow(
		"patient-intake-scheduling",
		[
			["request", "start", "Patient requests an appointment"],
			["intake", "process", "Clinic collects intake information"],
			["urgent", "decision", "Are there urgent symptoms?"],
			["triage", "process", "Nurse triage"],
			["same-day", "end", "Same-day appointment"],
			["insurance", "decision", "Is insurance valid?"],
			["routine", "end", routine],
			["self-pay", "decision", "Does the patient accept self-pay?"],
			["billing", "end", "Refer to billing"],
		],
		[
			["request", "intake"],
			["intake", "urgent"],
			["urgent", "triage", "Yes"],
			["urgent", "insurance", "No"],
			["triage", "same-day"],
			["insurance", "routine", "Valid"],
			["insurance", "self-pay", "Invalid"],
			["self-pay", "routine", "Yes"],
			["self-pay", "billing", "No"],
		],
	);
}

describe("paraphrased generations pass", () => {
	it.each(["Routine appointment", "Appointment (routine)", "Routine care"])(
		"accepts %s: the stated step without its leading verb",
		(routine) => {
			expect(failed(patientIntake(routine))).toEqual([]);
		},
	);

	it("keeps a question that restates a step's object as the decision", () => {
		const nodes = AI_APP_TAIL.map((node): NodeSpec =>
			node[0] === "cache" ? ["cache", "decision", "Is the answer cached?"] : node,
		);
		const edges = aiAppTailEdges("page", "Cache hit", "Cache miss");
		expect(
			failed(
				flow(
					"ai-app-stack-logos",
					[
						["vercel", "start", "Receive the request on Vercel", "vercel"],
						["page", "process", "Next.js page receives the question", "nextjs"],
						...nodes,
					],
					[["vercel", "page"], ...edges],
				),
			),
		).toEqual([]);
	});

	it("accepts a dimension question with value branches as the stated decision", () => {
		const result = flow(
			"password-reset-security",
			PASSWORD_RESET_NODES,
			passwordResetEdges("High risk", "Low risk"),
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts bare dimension values that complete the criterion", () => {
		const result = flow(
			"password-reset-security",
			PASSWORD_RESET_NODES,
			passwordResetEdges("High", "Low"),
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts question form, auxiliaries, articles, and inflection", () => {
		const result = flow(
			"support-ticket-triage",
			[
				["received", "start", "Ticket received"],
				["classify", "process", "Team classifies ticket"],
				["outage", "decision", "Is it a production outage?"],
				["page", "process", "Page on-call"],
				["outage-resolved", "end", "Outage resolved"],
				["known", "decision", "Does a known fix exist?"],
				["send", "process", "Send known fix to the customer"],
				["customer", "end", "Customer resolved"],
				["escalate", "process", "Escalate to engineering"],
				["engineering", "end", "Engineering resolved"],
			],
			[
				["received", "classify"],
				["classify", "outage"],
				["outage", "page", "Yes"],
				["page", "outage-resolved"],
				["outage", "known", "No"],
				["known", "send", "Yes"],
				["send", "customer"],
				["known", "escalate", "No"],
				["escalate", "engineering"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts compound splits and branches that restate the criterion", () => {
		const result = flow(
			"ci-release-gate",
			[
				["merged", "start", "Commit is merged"],
				["tests", "process", "Run the test suite"],
				["pass", "decision", "Did the tests pass?"],
				["block-tests", "end", "Block release: failed tests"],
				["build", "process", "Build an artifact"],
				["scan", "process", "Run a security scan"],
				["clean", "decision", "Is the security scan clean?"],
				["block-scan", "end", "Block release: failed scan"],
				["canary", "process", "Deploy a canary"],
				["healthy", "decision", "Is the canary healthy?"],
				["promote", "end", "Promote to production"],
				["rollback", "end", "Roll back the canary"],
			],
			[
				["merged", "tests"],
				["tests", "pass"],
				["pass", "block-tests", "Fail"],
				["pass", "build", "Pass"],
				["build", "scan"],
				["scan", "clean"],
				["clean", "block-scan", "Failed scan"],
				["clean", "canary", "Clean"],
				["canary", "healthy"],
				["healthy", "promote", "Healthy"],
				["healthy", "rollback", "Not healthy"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it.each(["Unhealthy", "No"])("accepts %s as the unhealthy canary branch", (branch) => {
		const result = flow(
			"ci-release-gate",
			[
				["merged", "start", "Commit merged"],
				["tests", "process", "Run test suite"],
				["pass", "decision", "Tests pass?"],
				["block", "end", "Block release"],
				["build", "process", "Build artifact"],
				["scan", "process", "Run security scan"],
				["clean", "decision", "Security scan clean?"],
				["canary", "process", "Deploy canary"],
				["healthy", "decision", "Canary healthy?"],
				["promote", "end", "Promote to production"],
				["rollback", "end", "Rollback canary"],
			],
			[
				["merged", "tests"],
				["tests", "pass"],
				["pass", "block", "Fail"],
				["pass", "build", "Pass"],
				["build", "scan"],
				["scan", "clean"],
				["clean", "block", "Failed scan"],
				["clean", "canary", "Clean scan"],
				["canary", "healthy"],
				["healthy", "promote", "Healthy"],
				["healthy", "rollback", branch],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it.each([
		"Decline application: exception not approved",
		"Decline application without exception approval",
	])("accepts a negated criterion as the no branch into %s", (declineLabel) => {
		const result = flow(
			"loan-application-underwriting",
			[
				["submitted", "start", "Application is submitted"],
				["verify", "process", "Verify identity"],
				["identity", "decision", "Is identity verified?"],
				["credit", "process", "Review credit"],
				["acceptable", "decision", "Is credit acceptable?"],
				["manual", "process", "Perform manual underwriting"],
				["exception", "decision", "Is an exception approved?"],
				["income", "process", "Verify income"],
				["approve", "end", "Approve the loan"],
				["decline-identity", "end", "Decline application: failed identity verification"],
				["decline-exception", "end", declineLabel],
			],
			[
				["submitted", "verify"],
				["verify", "identity"],
				["identity", "decline-identity", "Failed"],
				["identity", "credit", "Verified"],
				["credit", "acceptable"],
				["acceptable", "income", "Acceptable"],
				["acceptable", "manual", "Unacceptable"],
				["manual", "exception"],
				["exception", "income", "Approved"],
				["exception", "decline-exception", "Not approved"],
				["income", "approve"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("keeps an action whose trailing subordinate clause names a failure", () => {
		const result = flow(
			"feature-flag-rollout",
			[
				["ready", "start", "Flag is ready"],
				["internal", "process", "Enable internally"],
				["internal-healthy", "decision", "Are internal checks healthy?"],
				["beta", "process", "Enable the beta cohort"],
				["beta-healthy", "decision", "Are beta health checks healthy?"],
				["ramp", "process", "Ramp to all users"],
				["complete", "end", "Complete rollout"],
				["rollback-internal", "end", "Roll back the feature after failed internal checks"],
				["rollback-beta", "end", "Roll back the feature after unhealthy beta"],
			],
			[
				["ready", "internal"],
				["internal", "internal-healthy"],
				["internal-healthy", "beta", "Healthy"],
				["internal-healthy", "rollback-internal", "Fail"],
				["beta", "beta-healthy"],
				["beta-healthy", "ramp", "Healthy"],
				["beta-healthy", "rollback-beta", "Unhealthy"],
				["ramp", "complete"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts an imperative step for a stated passive event", () => {
		const result = flow(
			"procurement-vendor-approval",
			[
				["need", "start", "Identify a business need"],
				["quotes", "process", "Collect quotes"],
				["preferred", "decision", "Is there a preferred vendor?"],
				["bid", "process", "Run a competitive bid"],
				["risk", "process", "Conduct risk assessment"],
				["acceptable", "decision", "Is the risk acceptable?"],
				["reject", "end", "Reject the vendor"],
				["legal", "process", "Conduct legal review"],
				["approved", "decision", "Does legal approve?"],
				["contract", "end", "Create the contract"],
				["renegotiate", "process", "Renegotiate terms"],
			],
			[
				["need", "quotes"],
				["quotes", "preferred"],
				["preferred", "risk", "Yes"],
				["preferred", "bid", "No"],
				["bid", "risk"],
				["risk", "acceptable"],
				["acceptable", "reject", "No"],
				["acceptable", "legal", "Yes"],
				["legal", "approved"],
				["approved", "contract", "Yes"],
				["approved", "renegotiate", "No"],
				["renegotiate", "legal"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts the prompt's own wording on an unprompted loop caption", () => {
		const nodes: NodeSpec[] = [
			["alert", "start", "Alert is received"],
			["triage", "process", "Triage the alert"],
			["real", "decision", "Is it a real incident?"],
			["close", "end", "Close false alarm"],
			["declare", "process", "Declare the incident"],
			["notify", "process", "Notify stakeholders"],
			["collect", "process", "Collect logs and deploy evidence"],
			["cause", "decision", "Classify root cause"],
			["rollback", "process", "Roll back the deploy"],
			["hotfix", "process", "Prepare a hotfix"],
			["provider", "end", "Escalate to the provider"],
			["stable", "decision", "Is the service stable?"],
			["monitor", "process", "Monitor the service"],
			["resolved", "end", "Incident resolved"],
			["escalate", "process", "Escalate the unstable incident"],
		];
		const edges = (loopCaption?: string): EdgeSpec[] => [
			["alert", "triage"],
			["triage", "real"],
			["real", "close", "No — false alarm"],
			["real", "declare", "Yes — real incident"],
			["declare", "notify"],
			["notify", "collect"],
			["collect", "cause"],
			["cause", "rollback", "Deploy"],
			["cause", "hotfix", "Code"],
			["cause", "provider", "Provider"],
			["rollback", "stable"],
			["hotfix", "stable"],
			["stable", "monitor", "Yes — stable"],
			["monitor", "resolved"],
			["stable", "escalate", "No — unstable"],
			["escalate", "collect", loopCaption],
		];
		expect(
			failed(flow("incident-response-code-mode-proof", nodes, edges("Collect fresh evidence"))),
		).toEqual([]);
		expect(failed(flow("incident-response-code-mode-proof", nodes, edges()))).toEqual([]);
	});

	it("accepts criterion branches on a named-technology pipeline", () => {
		const result = flow(
			"deploy-pipeline-logos",
			[
				["push", "start", "Push to GitHub", "github"],
				["build", "process", "Docker builds the image", "docker"],
				["tests", "process", "Run the test suite"],
				["pass", "decision", "Do the tests pass?"],
				["ship", "end", "Ship to Cloudflare Workers", "cloudflare"],
				["notify", "process", "Notify the team"],
				["stop", "end", "Stop the pipeline"],
			],
			[
				["push", "build"],
				["build", "tests"],
				["tests", "pass"],
				["pass", "ship", "Pass"],
				["pass", "notify", "Fail"],
				["notify", "stop"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts a check drawn as the decision with exactly the stated outcomes", () => {
		expect(failed(warehouseMerged("Available", "Unavailable"))).toEqual([]);
	});

	it("grades a merged check the same whatever the model's node ids", () => {
		const result = flow(
			"warehouse-reorder",
			[
				...WAREHOUSE_HEAD,
				["check", "decision", "Check supplier availability"],
				["substitute", "process", "Use a substitute supplier"],
				["check#decision", "process", "Create a purchase order"],
				["check#split", "end", "Await delivery"],
			],
			[
				["updated", "below"],
				["below", "monitor", "No"],
				["below", "check", "Yes"],
				["check", "check#decision", "Available"],
				["check", "substitute", "Unavailable"],
				["substitute", "check#decision"],
				["check#decision", "check#split"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts the six stated stages without repo package names", () => {
		const result = flow(
			"repo-package-interaction-flow",
			REPO_STAGES,
			REPO_STAGES.slice(1).map(([id], index) => [REPO_STAGES[index]![0], id]),
		);
		expect(failed(result)).toEqual([]);
	});

	it.each([
		[
			"Vercel before the page",
			[
				["vercel", "start", "Receive the request on Vercel", "vercel"],
				["page", "process", "Next.js page receives the question", "nextjs"],
			],
		],
		[
			"a bare start, then Vercel",
			[
				["arrives", "start", "Question arrives"],
				["vercel", "process", "Vercel hosts the page", "vercel"],
				["page", "process", "Next.js page receives the question", "nextjs"],
			],
		],
		[
			"the page before Vercel",
			[
				["page", "start", "Next.js page receives the question", "nextjs"],
				["vercel", "process", "Vercel routes the request", "vercel"],
			],
		],
	] as const)("accepts the stated first event drawn as %s", (_shape, entry) => {
		const nodes: NodeSpec[] = [...entry, ...AI_APP_TAIL];
		const edges: EdgeSpec[] = [
			...entry.slice(1).map(([id], index): EdgeSpec => [entry[index]![0], id]),
			...aiAppTailEdges(entry.at(-1)![0], "Yes", "No"),
		];
		expect(failed(flow("ai-app-stack-logos", nodes, edges))).toEqual([]);
	});

	it("accepts a stated end followed by a retry loop", () => {
		const result = flow(
			"expense-reimbursement",
			[
				["submitted", "start", "Expense submitted"],
				["attached", "decision", "Receipt attached?"],
				["request", "process", "Request a receipt"],
				["policy", "process", "Run a policy check"],
				["within", "decision", "Within policy?"],
				["manager", "process", "Manager approval"],
				["payment", "end", "Payment"],
				["exception", "process", "Finance exception review"],
				["approved", "decision", "Exception approved?"],
				["reject", "end", "Reject the expense"],
			],
			[
				["submitted", "attached"],
				["attached", "request", "Missing"],
				["request", "attached", "Receipt provided"],
				["attached", "policy", "Attached"],
				["policy", "within"],
				["within", "manager", "Yes"],
				["manager", "payment"],
				["within", "exception", "No"],
				["exception", "approved"],
				["approved", "manager", "Approved"],
				["approved", "reject", "Rejected"],
			],
		);
		expect(failed(result)).toEqual([]);
	});

	it("accepts a branch target qualified by its decision and branch", () => {
		expect(
			failed(
				flow("incident-escalation", INCIDENT_ESCALATION_NODES, incidentEscalationEdges("Low")),
			),
		).toEqual([]);
	});
});

describe("real losses still fail", () => {
	it.each(["Appointment", "Cancel routine appointment", "No routine appointment", "Routine visit"])(
		"fails %s for the stated routine appointment",
		(routine) => {
			expect(failed(patientIntake(routine))).toContain("node-label:Schedule routine appointment");
		},
	);

	it.each([
		["tests-block", "Not failed", "edge:Tests pass?->Block release:no"],
		["canary-rollback", "Not unhealthy", "edge:Canary healthy?->Rollback canary:no"],
		["canary-promote", "Canary", "edge:Canary healthy?->Promote production:yes"],
		["scan-canary", "Scan", "edge:Security scan clean?->Deploy canary:yes"],
	])("fails the %s caption %s: no stated outcome, or a double negation", (edgeId, label, check) => {
		const scenario = getFlowchartScenario("ci-release-gate");
		const result = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			edges: scenario.expectedDiagram.edges.map((edge) =>
				edge.id === edgeId ? { ...edge, label } : edge,
			),
		});
		expect(failed(result)).toContain(check);
	});

	it.each([
		["bare yes/no branches", "Yes", "No"],
		["outcomes of a different decision", "In stock", "Out of stock"],
	])("fails a check drawn as a decision with %s", (_case, available, unavailable) => {
		expect(failed(warehouseMerged(available, unavailable))).toEqual(
			expect.arrayContaining([
				"node-label:Check supplier availability",
				"node-label:Supplier available?",
			]),
		);
	});

	it("fails stated stages out of order", () => {
		const order = ["request", "agent", "renderer", "core", "export", "response"];
		const result = flow(
			"repo-package-interaction-flow",
			REPO_STAGES,
			order.slice(1).map((id, index) => [order[index]!, id]),
		);
		expect(failed(result)).toEqual(
			expect.arrayContaining([
				"edge:Agent->Core diagram model",
				"edge:Renderer->Excalidraw export",
			]),
		);
	});

	it("fails a dropped stated stage", () => {
		const stages = REPO_STAGES.filter(([id]) => id !== "renderer");
		const result = flow(
			"repo-package-interaction-flow",
			stages,
			stages.slice(1).map(([id], index) => [stages[index]![0], id]),
		);
		expect(failed(result)).toContain("node-label:Renderer");
	});

	it("accepts the stated final outcome drawn as a plain action and its end", () => {
		const split = (stored: string, end: string) => {
			const stages: NodeSpec[] = [
				...REPO_STAGES.filter(([id]) => id !== "response"),
				["hosted", "process", stored],
				["response", "end", end],
			];
			return failed(
				flow(
					"repo-package-interaction-flow",
					stages,
					stages.slice(1).map(([id], index) => [stages[index]![0], id]),
				),
			);
		};
		expect(split("Hosted artifact", "Artifact response")).toEqual([]);
		// The combined labels must still name the outcome.
		expect(split("Hosted artifact", "Done")).toContain("node-label:Hosted artifact response");
		expect(split("Store artifact", "Artifact response")).toContain(
			"node-label:Hosted artifact response",
		);
	});

	it("fails a first event that drops Vercel", () => {
		const result = flow(
			"ai-app-stack-logos",
			[["page", "start", "Next.js page receives the question", "nextjs"], ...AI_APP_TAIL],
			aiAppTailEdges("page", "Hit", "Miss"),
		);
		expect(failed(result)).toEqual(
			expect.arrayContaining([
				"node-label:Request reaches Vercel → Next.js page receives question",
				"icon:vercel",
			]),
		);
	});

	it("fails value-question answers wired to the wrong outcomes", () => {
		const result = flow(
			"ai-app-stack-logos",
			[
				["vercel", "start", "Receive the request on Vercel", "vercel"],
				["page", "process", "Next.js page receives the question", "nextjs"],
				...AI_APP_TAIL,
			],
			[["vercel", "page"], ...aiAppTailEdges("page", "No", "Yes")],
		);
		expect(failed(result)).toEqual(
			expect.arrayContaining([
				"edge:Cached in Redis?->Return cached answer:hit",
				"edge:Cached in Redis?->Call the OpenAI model:miss",
			]),
		);
	});

	it("fails a target qualified by the wrong branch", () => {
		expect(
			failed(
				flow("incident-escalation", INCIDENT_ESCALATION_NODES, incidentEscalationEdges("Medium")),
			),
		).toContain("node-label:Monitor low severity");
	});

	it.each([
		["Call the model", "Store the answer in Redis", "node-label:Call the OpenAI model"],
		["Call the OpenAI model", "Store the answer in the cache", "node-label:Store answer in Redis"],
	])("fails a step that drops its named technology (%s / %s)", (call, store, check) => {
		const result = flow(
			"ai-app-stack-logos",
			[
				["request", "start", "Next.js page receives the question", "nextjs"],
				["edge", "process", "Vercel routes the request", "vercel"],
				["cache", "decision", "Cached in Redis?", "redis"],
				["cached", "end", "Return the cached answer"],
				["model", "process", call, "openai"],
				["store", "process", store, "redis"],
				["log", "process", "Log errors to Sentry", "sentry"],
				["answer", "end", "Return the answer"],
			],
			[
				["request", "edge"],
				["edge", "cache"],
				["cache", "cached", "Hit"],
				["cache", "model", "Miss"],
				["model", "store"],
				["store", "log"],
				["log", "answer"],
			],
		);
		expect(failed(result)).toContain(check);
	});

	it("fails a stated loop drawn as a differently named end", () => {
		const result = flow(
			"subscription-renewal-dunning",
			[
				["due", "start", "Renewal is due"],
				["charge", "process", "Charge payment"],
				["succeeded", "decision", "Did payment succeed?"],
				["renew", "end", "Renew the subscription"],
				["reminder", "process", "Send a reminder"],
				["updated", "decision", "Was payment updated?"],
				["grace", "decision", "Has the grace period expired?"],
				["pause", "end", "Pause the subscription"],
				["another", "end", "Send another reminder"],
			],
			[
				["due", "charge"],
				["charge", "succeeded"],
				["succeeded", "renew", "Yes"],
				["succeeded", "reminder", "No"],
				["reminder", "updated"],
				["updated", "charge", "Yes — retry charge"],
				["updated", "grace", "No"],
				["grace", "pause", "Yes"],
				["grace", "another", "No"],
			],
		);
		expect(failed(result)).toEqual(["edge:Grace period expired?->Send reminder:no"]);
	});

	it("fails dimension values wired to the wrong outcomes", () => {
		const result = flow(
			"password-reset-security",
			PASSWORD_RESET_NODES,
			passwordResetEdges("Low risk", "High risk"),
		);
		expect(failed(result)).toEqual(
			expect.arrayContaining([
				"edge:Risk high?->Step-up verification:yes",
				"edge:Risk high?->Reset password:no",
			]),
		);
	});

	it("fails a dimension question whose branches never state the criterion", () => {
		const result = flow(
			"password-reset-security",
			PASSWORD_RESET_NODES,
			passwordResetEdges("Elevated", "Normal"),
		);
		expect(failed(result)).toContain("node-label:Risk high?");
	});

	it("fails a criterion restatement on the opposite branch", () => {
		const result = flow(
			"ci-release-gate",
			[
				["merged", "start", "Commit merged"],
				["tests", "process", "Run test suite"],
				["pass", "decision", "Tests pass?"],
				["block", "end", "Block release"],
				["build", "process", "Build artifact"],
				["scan", "process", "Run security scan"],
				["clean", "decision", "Security scan clean?"],
				["canary", "process", "Deploy canary"],
				["healthy", "decision", "Canary healthy?"],
				["promote", "end", "Promote to production"],
				["rollback", "end", "Rollback canary"],
			],
			[
				["merged", "tests"],
				["tests", "pass"],
				["pass", "block", "Pass"],
				["pass", "build", "Fail"],
				["build", "scan"],
				["scan", "clean"],
				["clean", "block", "Failed scan"],
				["clean", "canary", "Clean scan"],
				["canary", "healthy"],
				["healthy", "promote", "Not healthy"],
				["healthy", "rollback", "Healthy"],
			],
		);
		expect(failed(result)).toEqual(
			expect.arrayContaining([
				"edge:Tests pass?->Build artifact:yes",
				"edge:Tests pass?->Block release:no",
				"edge:Canary healthy?->Promote production:yes",
				"edge:Canary healthy?->Rollback canary:no",
			]),
		);
	});
});

describe("decisions asked by their opposite condition", () => {
	/** The fixture with one decision relabeled and, optionally, its yes and no swapped. */
	function invert(scenarioId: string, nodeId: string, label: string, swap: boolean) {
		const scenario = getFlowchartScenario(scenarioId);
		const swapped: Record<string, string> = { yes: "no", no: "yes" };
		return evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === nodeId ? { ...node, label } : node,
			),
			edges: scenario.expectedDiagram.edges.map((edge) =>
				swap && edge.source === nodeId && edge.label
					? { ...edge, label: swapped[edge.label] }
					: edge,
			),
		});
	}

	const INVERTED = [
		["expense-reimbursement", "receipt-attached", "Receipt missing?"],
		["expense-reimbursement", "receipt-attached", "Is the receipt missing?"],
		["invoice-approval", "po-matches", "Does the invoice not match the PO?"],
		["data-import-validation", "parse-success", "Parsing failed?"],
		["password-reset-security", "account-exists", "Account does not exist?"],
		["password-reset-security", "link-clicked", "Link not clicked?"],
		["loan-application-underwriting", "identity-verified", "Identity verification failed?"],
		["bug-report-routing", "reproduced", "Cannot be reproduced?"],
		["ci-release-gate", "tests-pass", "Tests failed?"],
		["ci-release-gate", "scan-clean", "Security scan failed?"],
		["procurement-vendor-approval", "risk-acceptable", "Risk not acceptable?"],
	] as const;

	it.each(INVERTED)("%s accepts %s asked as %s with swapped answers", (scenario, node, label) => {
		expect(failed(invert(scenario, node, label, true))).toEqual([]);
	});

	it.each(INVERTED)("%s fails %s asked as %s with unswapped answers", (scenario, node, label) => {
		expect(failed(invert(scenario, node, label, false))).not.toEqual([]);
	});

	it("accepts the observed Sonnet captions: yes to the request, 'no, attached' to the check", () => {
		const nodes: NodeSpec[] = [
			["s", "start", "Expense is submitted"],
			["d1", "decision", "Receipt missing?"],
			["rr", "end", "Request a receipt"],
			["pc", "process", "Run policy check"],
			["d2", "decision", "Within policy?"],
			["ma", "process", "Manager approval"],
			["pay", "end", "Payment"],
			["fe", "process", "Finance exception review"],
			["d3", "decision", "Exception approved?"],
			["rej", "end", "Reject the expense"],
		];
		const edges = (missing: string, attached: string): EdgeSpec[] => [
			["s", "d1"],
			["d1", "rr", missing],
			["d1", "pc", attached],
			["pc", "d2"],
			["d2", "ma", "yes"],
			["ma", "pay"],
			["d2", "fe", "no"],
			["fe", "d3"],
			["d3", "ma", "approved"],
			["d3", "rej", "rejected"],
		];
		expect(failed(flow("expense-reimbursement", nodes, edges("yes", "no, attached")))).toEqual([]);
		expect(failed(flow("expense-reimbursement", nodes, edges("Missing", "Not missing")))).toEqual(
			[],
		);
		// Stated outcomes keep their meaning: "attached" on the request branch is still wrong.
		expect(failed(flow("expense-reimbursement", nodes, edges("attached", "missing")))).toContain(
			"edge:Receipt attached?->Request receipt:no",
		);
	});

	it("keeps decisions without a stated opposite condition strict", () => {
		// The prompt asks "whether the exception is resolved", so that is the decision.
		expect(
			failed(invert("invoice-approval", "exception-resolved", "Exception unresolved?", true)),
		).toContain("node-label:Exception resolved?");
		expect(
			failed(invert("feature-flag-rollout", "internal-healthy", "Internal checks failed?", true)),
		).toContain("node-label:Internal healthy?");
	});

	it("accepts threshold branches captioned by the comparison's two sides", () => {
		const nodes: NodeSpec[] = [
			["recv", "start", "Invoice is received"],
			["match", "process", "Match invoice to purchase order"],
			["m", "decision", "Does the invoice match?"],
			["exc", "process", "Route to exception review"],
			["res", "decision", "Is the exception resolved?"],
			["rej", "end", "Reject invoice"],
			["thr", "decision", "Is the amount over the approval threshold?"],
			["dir", "process", "Director approval"],
			["pay", "end", "Schedule payment"],
		];
		const edges = (over: string, under: string): EdgeSpec[] => [
			["recv", "match"],
			["match", "m"],
			["m", "exc", "no"],
			["m", "thr", "yes"],
			["exc", "res"],
			["res", "rej", "no"],
			["res", "thr", "yes"],
			["thr", "dir", over],
			["thr", "pay", under],
			["dir", "pay"],
		];
		expect(failed(flow("invoice-approval", nodes, edges("Over", "Under")))).toEqual([]);
		expect(failed(flow("invoice-approval", nodes, edges("Under", "Over")))).toContain(
			"edge:Amount over threshold?->Director approval:yes",
		);
	});
});
