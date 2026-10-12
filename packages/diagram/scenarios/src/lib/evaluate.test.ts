import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@sketchi/diagram-excalidraw";

import {
	evaluateScenarioDiagram,
	evaluateScenarioFixture,
	evaluateScenarioOutput,
	extractJsonCandidate,
} from "./evaluate";
import { flowchartScenarios, getFlowchartScenario } from "./scenarios";

const onboardingScenario = getFlowchartScenario("sketchi-onboarding-decision-flow");
const MOVE_DELTA = { x: 48, y: 32 };

function numericBounds(element: ExcalidrawElement | undefined) {
	if (
		!element ||
		typeof element.x !== "number" ||
		typeof element.y !== "number" ||
		typeof element.width !== "number" ||
		typeof element.height !== "number"
	) {
		throw new Error(`Expected numeric bounds for ${element?.id ?? "element"}.`);
	}

	return {
		x: element.x,
		y: element.y,
		width: element.width,
		height: element.height,
	};
}

function binding(element: ExcalidrawElement, key: "startBinding" | "endBinding") {
	const value = element[key];
	if (!(value && typeof value === "object")) {
		throw new Error(`Expected ${element.id} ${key}.`);
	}

	const elementId = (value as { elementId?: unknown }).elementId;
	const fixedPoint = (value as { fixedPoint?: unknown }).fixedPoint;
	const gap = (value as { gap?: unknown }).gap;

	if (
		typeof elementId !== "string" ||
		typeof gap !== "number" ||
		!Array.isArray(fixedPoint) ||
		fixedPoint.length < 2 ||
		typeof fixedPoint[0] !== "number" ||
		typeof fixedPoint[1] !== "number"
	) {
		throw new Error(`Expected ${element.id} ${key} fixedPoint metadata.`);
	}

	return {
		elementId,
		gap,
		fixedPoint: [
			Math.abs(fixedPoint[0] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[0],
			Math.abs(fixedPoint[1] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[1],
		] as const,
	};
}

function arrowEndpoint(element: ExcalidrawElement, key: "startBinding" | "endBinding") {
	const points = element.points;
	if (typeof element.x !== "number" || typeof element.y !== "number" || !Array.isArray(points)) {
		throw new Error(`Expected numeric arrow points for ${element.id}.`);
	}

	const point = key === "startBinding" ? points[0] : points[points.length - 1];
	if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number") {
		throw new Error(`Expected ${element.id} ${key} endpoint.`);
	}

	return {
		x: element.x + point[0],
		y: element.y + point[1],
	};
}

function pointFromBinding(
	shape: ExcalidrawElement | undefined,
	fixedPoint: readonly [number, number],
) {
	const bounds = numericBounds(shape);
	return {
		x: bounds.x + bounds.width * fixedPoint[0],
		y: bounds.y + bounds.height * fixedPoint[1],
	};
}

function expectClosePoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
	expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.05);
	expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.05);
}

describe("diagram scenario evaluation", () => {
	it("accepts prompt-derived wording throughout the maintained catalog", () => {
		for (const scenario of flowchartScenarios) {
			const labels = new Map(
				scenario.assertions.requiredNodes.map((node) => [node.id, node.labels[0]]),
			);
			const result = evaluateScenarioDiagram(scenario, {
				...scenario.expectedDiagram,
				nodes: scenario.expectedDiagram.nodes.map((node) => ({
					...node,
					label: labels.get(node.id) ?? "",
				})),
			});
			expect(
				result.ok,
				`${scenario.id}: ${result.checks
					.filter((check) => !check.passed)
					.map((check) => check.message)
					.join(", ")}`,
			).toBe(true);
		}
	});

	it("accepts prompt wording with punctuation and whitespace differences", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) => ({
				...node,
				label:
					{
						prompt: "A prompt is received",
						requirements: "Extracts requirements",
						clear: "Is the SCOPE clear?",
						draft: "Drafts typed-IR",
						review: "Review",
					}[node.id] ?? node.label,
			})),
		};
		expect(evaluateScenarioDiagram(onboardingScenario, candidate).ok).toBe(true);
	});

	it("accepts separate matching end nodes for each path", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			nodes: [
				...onboardingScenario.expectedDiagram.nodes.map((node) =>
					node.id === "review" ? { ...node, label: "Review clear request" } : node,
				),
				{ id: "unclear-review", label: "Review unclear request", kind: "end" },
			],
			edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
				edge.id === "clear-review" ? { ...edge, target: "unclear-review" } : edge,
			),
		};
		expect(evaluateScenarioDiagram(onboardingScenario, candidate).ok).toBe(true);
	});

	it("fails a missing step even with enough padding nodes and edges", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) =>
				node.id === "draft" ? { ...node, label: "Unrelated work" } : node,
			),
		};
		const result = evaluateScenarioDiagram(onboardingScenario, candidate);
		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "min-node-count", passed: true }),
		);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "node-label:Draft typed IR", passed: false }),
		);
	});

	it.each([
		["acknowledge", "Responder ignores alert", "Responder acknowledges"],
		["mitigate", "Inspect impact", "Mitigate impact"],
		["customer-comms", "Discard customer communications", "Send customer comms"],
		["monitor", "Ignore low severity", "Monitor low severity"],
		["resolved", "Incident not resolved", "Incident resolved"],
	])("rejects a missing or negated action in %s", (id, label, expectedLabel) => {
		const scenario = getFlowchartScenario("incident-escalation");
		const result = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === id ? { ...node, label } : node,
			),
		});
		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: `node-label:${expectedLabel}`, passed: false }),
		);
	});

	it("rejects two required steps combined into one node, even with connected padding", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) =>
				node.id === "draft"
					? { ...node, label: "Extract requirements and draft typed IR" }
					: node.id === "requirements"
						? { ...node, label: "Unrelated work" }
						: node,
			),
			edges: [
				{ id: "a", source: "prompt", target: "draft" },
				{ id: "b", source: "draft", target: "clear" },
				{ id: "c", source: "clear", target: "draft", label: "yes" },
				{ id: "d", source: "clear", target: "review", label: "no" },
				{ id: "e", source: "draft", target: "review" },
				{ id: "f", source: "prompt", target: "requirements" },
				{ id: "g", source: "requirements", target: "review" },
			],
		});
		expect(result.ok).toBe(false);
		expect(
			result.checks.filter((check) => check.id.startsWith("edge:")).some((check) => !check.passed),
		).toBe(true);
		expect(
			result.checks
				.filter((check) => check.id.startsWith("node-label:"))
				.some((check) => !check.passed),
		).toBe(true);
	});

	it("uses distinct alternatives when an earlier step can also match a later step", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) =>
				node.id === "requirements"
					? { ...node, label: "Extract requirements and draft typed IR" }
					: node.id === "draft"
						? { ...node, label: "Extract requirements" }
						: node,
			),
			edges: [
				{ id: "a", source: "prompt", target: "draft" },
				{ id: "b", source: "draft", target: "clear" },
				{ id: "c", source: "clear", target: "requirements", label: "yes" },
				{ id: "d", source: "clear", target: "review", label: "no" },
				{ id: "e", source: "requirements", target: "review" },
			],
		});
		expect(result.ok).toBe(true);
	});

	it("does not wire two required steps through one combined node while using named padding as a witness", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) =>
				node.id === "draft" ? { ...node, label: "Extract requirements and draft typed IR" } : node,
			),
			edges: [
				{ id: "a", source: "prompt", target: "draft" },
				{ id: "b", source: "draft", target: "clear" },
				{ id: "c", source: "clear", target: "draft", label: "yes" },
				{ id: "d", source: "clear", target: "review", label: "no" },
				{ id: "e", source: "draft", target: "review" },
				{ id: "f", source: "prompt", target: "requirements" },
				{ id: "g", source: "requirements", target: "review" },
			],
		});
		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				id: "edge:Extract requirements->Scope clear?",
				passed: false,
			}),
		);
	});

	it("finds a connected assignment when both process labels contain both actions", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: onboardingScenario.expectedDiagram.nodes.map((node) =>
				node.kind === "process"
					? { ...node, label: "Extract requirements and draft typed IR" }
					: node,
			),
		});
		expect(result.ok).toBe(true);
	});

	it("does not stitch intermediate witnesses across a different step", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: [
				...onboardingScenario.expectedDiagram.nodes,
				{ id: "requirements-b", label: "Extract requirements", kind: "process" },
			],
			edges: [
				{ id: "a", source: "prompt", target: "requirements" },
				{ id: "b", source: "requirements", target: "draft" },
				{ id: "c", source: "draft", target: "requirements-b" },
				{ id: "d", source: "requirements-b", target: "clear" },
				{ id: "e", source: "clear", target: "draft", label: "yes" },
				{ id: "f", source: "clear", target: "review", label: "no" },
				{ id: "g", source: "draft", target: "review" },
			],
		});
		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "edge:Extract requirements->Scope clear?", passed: false }),
		);
	});

	it("accepts a continuous split of an intermediate step", () => {
		const result = evaluateScenarioDiagram(onboardingScenario, {
			...onboardingScenario.expectedDiagram,
			nodes: [
				...onboardingScenario.expectedDiagram.nodes,
				{ id: "requirements-b", label: "Extract requirements", kind: "process" },
			],
			edges: [
				...onboardingScenario.expectedDiagram.edges.map((edge) =>
					edge.id === "requirements-clear" ? { ...edge, source: "requirements-b" } : edge,
				),
				{ id: "internal-requirements", source: "requirements", target: "requirements-b" },
			],
		});
		expect(result.ok).toBe(true);
	});

	it.each([
		["ecommerce-return-authorization", "reject-return", "Not eligible? Reject return"],
		["subscription-renewal-dunning", "send-reminder", "Payment fails. Send reminder"],
		["ecommerce-return-authorization", "reject-return", "Not eligible → Reject return"],
		["subscription-renewal-dunning", "send-reminder", "Payment fails - Send reminder"],
		["subscription-renewal-dunning", "send-reminder", "Payment fails then send reminder"],
		["ci-release-gate", "block-release", "Failed tests block release"],
		["ci-release-gate", "block-release", "A failed scan blocks release"],
		["restaurant-waitlist", "remove-list", "No response removes the party from the list"],
		["restaurant-waitlist", "keep-waiting", "Not ready keeps waiting"],
	])(
		"accepts a positive action after a negative condition in %s: %s: %s",
		(scenarioId, nodeId, label) => {
			const scenario = getFlowchartScenario(scenarioId);
			const result = evaluateScenarioDiagram(scenario, {
				...scenario.expectedDiagram,
				nodes: scenario.expectedDiagram.nodes.map((node) =>
					node.id === nodeId ? { ...node, label } : node,
				),
			});
			expect(result.ok).toBe(true);
		},
	);

	it.each([
		["sketchi-onboarding-decision-flow", "review", "otherwise moves to review"],
		["pharma-batch-disposition", "reject", "Reject ends at reject batch"],
		["support-ticket-triage", "known-fix", "Non-outages check whether a known fix exists"],
		[
			"support-ticket-triage",
			"escalate-engineering",
			"Unknown fixes escalate to engineering and end as engineering resolved",
		],
		[
			"support-ticket-triage",
			"engineering-resolved",
			"Unknown fixes escalate to engineering and end as engineering resolved",
		],
		[
			"ecommerce-return-authorization",
			"reject-return",
			"Ineligible or unacceptable returns end as rejected returns",
		],
		["incident-escalation", "incident-bridge", "If no, escalate to the incident bridge"],
		["incident-response-code-mode-proof", "false-alarm", "False alarms close"],
		[
			"incident-response-code-mode-proof",
			"escalate-failure",
			"Unstable service escalates and loops back to collect fresh evidence",
		],
		["invoice-approval", "exception-review", "If it does not match, route it to exception review"],
		["invoice-approval", "reject-invoice", "Unresolved exceptions reject the invoice"],
		["feature-flag-rollout", "rollback", "If internal checks fail, roll back the feature"],
		["feature-flag-rollout", "rollback", "Unhealthy beta rolls back the feature"],
		[
			"patient-intake-scheduling",
			"insurance-valid",
			"Non-urgent requests check whether insurance is valid",
		],
		[
			"patient-intake-scheduling",
			"self-pay",
			"Invalid insurance asks if the patient accepts self-pay",
		],
		["patient-intake-scheduling", "billing", "otherwise refer to billing"],
		[
			"content-moderation",
			"policy-violation",
			"If not severe, decide whether there is a policy violation",
		],
		["content-moderation", "restore-content", "No violation restores content"],
		["content-moderation", "restore-content", "otherwise restore content"],
		["data-import-validation", "reject-file", "If parsing fails, reject the file"],
		["data-import-validation", "mapping-errors", "Invalid schema returns mapping errors"],
		["data-import-validation", "import-records", "If not, import records directly"],
		[
			"password-reset-security",
			"generic-response",
			"If the account does not exist, show a generic response",
		],
		["password-reset-security", "expire-token", "If the link is not clicked, expire the token"],
		["warehouse-reorder", "monitor-stock", "If not, monitor stock"],
		[
			"warehouse-reorder",
			"substitute-supplier",
			"Unavailable suppliers use a substitute supplier before creating the purchase order",
		],
		[
			"warehouse-reorder",
			"purchase-order",
			"Unavailable suppliers use a substitute supplier before creating the purchase order",
		],
		[
			"loan-application-underwriting",
			"decline-application",
			"Failed identity verification declines the application",
		],
		[
			"loan-application-underwriting",
			"manual-underwrite",
			"Unacceptable credit goes to manual underwriting",
		],
		[
			"customer-offboarding-retention",
			"confirm-cancel",
			"Declined offers confirm cancellation and close the account",
		],
		[
			"customer-offboarding-retention",
			"close-account",
			"Declined offers confirm cancellation and close the account",
		],
		[
			"customer-offboarding-retention",
			"confirm-cancel",
			"If the customer is not eligible for a save offer, confirm cancellation directly and close the account",
		],
		[
			"customer-offboarding-retention",
			"close-account",
			"If the customer is not eligible for a save offer, confirm cancellation directly and close the account",
		],
		["bug-report-routing", "request-details", "If it cannot be reproduced, request more details"],
		["bug-report-routing", "priority-high", "Non-security issues decide whether priority is high"],
		["expense-reimbursement", "request-receipt", "If the receipt is missing, request a receipt"],
		[
			"expense-reimbursement",
			"finance-exception",
			"Out-of-policy expenses go to finance exception review",
		],
		["expense-reimbursement", "reject-expense", "rejected exceptions reject the expense"],
		["restaurant-waitlist", "add-waitlist", "If not, add the party to the waitlist"],
		["restaurant-waitlist", "remove-list", "No response removes the party from the list"],
		["restaurant-waitlist", "keep-waiting", "not ready keeps waiting and checks response again"],
		["ci-release-gate", "block-release", "Failed tests block release"],
		["ci-release-gate", "block-release", "A failed scan blocks release"],
		["ci-release-gate", "rollback-canary", "If not, roll back the canary"],
		[
			"procurement-vendor-approval",
			"competitive-bid",
			"If not, run a competitive bid first and then risk assessment",
		],
		[
			"procurement-vendor-approval",
			"risk-assessment",
			"If not, run a competitive bid first and then risk assessment",
		],
		[
			"procurement-vendor-approval",
			"reject-vendor",
			"Risk that is not acceptable rejects the vendor",
		],
		[
			"procurement-vendor-approval",
			"renegotiate",
			"If legal does not approve, renegotiate terms and repeat legal review",
		],
		[
			"procurement-vendor-approval",
			"legal-review",
			"If legal does not approve, renegotiate terms and repeat legal review",
		],
		[
			"subscription-renewal-dunning",
			"send-reminder",
			"If payment fails, send a reminder and decide whether payment was updated",
		],
		[
			"subscription-renewal-dunning",
			"grace-expired",
			"If not updated, decide whether the grace period has expired",
		],
		["subscription-renewal-dunning", "send-reminder", "otherwise send another reminder"],
		["deploy-pipeline-logos", "notify", "otherwise notify the team and stop"],
		[
			"ai-app-stack-logos",
			"model",
			"On a miss, call the OpenAI model, store the answer in Redis, and log any errors to Sentry before returning the answer",
		],
		[
			"ai-app-stack-logos",
			"store",
			"On a miss, call the OpenAI model, store the answer in Redis, and log any errors to Sentry before returning the answer",
		],
		[
			"ai-app-stack-logos",
			"log",
			"On a miss, call the OpenAI model, store the answer in Redis, and log any errors to Sentry before returning the answer",
		],
		[
			"ai-app-stack-logos",
			"answer",
			"On a miss, call the OpenAI model, store the answer in Redis, and log any errors to Sentry before returning the answer",
		],
	])("accepts the complete prompt consequence in %s: %s: %s", (scenarioId, nodeId, label) => {
		const scenario = getFlowchartScenario(scenarioId);
		const expected = scenario.assertions.requiredNodes.find((node) => node.id === nodeId)!;
		expect(scenario.prompt.toLowerCase()).toContain(label.toLowerCase());
		const result = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === nodeId ? { ...node, label } : node,
			),
		});
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: `node-label:${expected.label}`, passed: true }),
		);
		for (const edge of scenario.assertions.requiredEdges.filter(
			(edge) => edge.targetId === nodeId,
		)) {
			expect(result.checks).toContainEqual(
				expect.objectContaining({
					id: `edge:${edge.sourceLabel}->${edge.targetLabel}${edge.label ? `:${edge.label}` : ""}`,
					passed: true,
				}),
			);
		}
		expect(result.ok).toBe(true);
		expect(expected.labels.map((label) => label.toLowerCase())).toContain(label.toLowerCase());
	});

	it.each([
		["ci-release-gate", "block-release", "Failed tests do not block release"],
		["restaurant-waitlist", "remove-list", "No response does not remove the party"],
		["restaurant-waitlist", "keep-waiting", "Not ready never keeps waiting"],
		["feature-flag-rollout", "rollback", "Unhealthy beta does not roll back the feature"],
		["data-import-validation", "import-records", "If not, do not import records directly"],
		["warehouse-reorder", "monitor-stock", "If not, do not monitor stock"],
		["restaurant-waitlist", "add-waitlist", "If not, do not add the party to the waitlist"],
		["ci-release-gate", "rollback-canary", "If not, do not roll back the canary"],
		["content-moderation", "restore-content", "No violation does not restore content"],
		[
			"procurement-vendor-approval",
			"reject-vendor",
			"Risk that is not acceptable does not reject the vendor",
		],
	])("rejects a negated consequence in %s: %s: %s", (scenarioId, nodeId, label) => {
		const scenario = getFlowchartScenario(scenarioId);
		expect(
			evaluateScenarioDiagram(scenario, {
				...scenario.expectedDiagram,
				nodes: scenario.expectedDiagram.nodes.map((node) =>
					node.id === nodeId ? { ...node, label } : node,
				),
			}).ok,
		).toBe(false);
	});

	it("requires each step's node kind even when all kinds remain present", () => {
		const scenario = getFlowchartScenario("incident-escalation");
		const candidate = {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === "severity" ? { ...node, kind: "process" } : node,
			),
		};
		const result = evaluateScenarioDiagram(scenario, candidate);
		expect(result.ok).toBe(false);
		expect(result.checks.filter((check) => check.id.startsWith("node-kind:"))).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "node-kind:decision", passed: true })]),
		);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "node-label:Severity?", passed: false }),
		);
	});

	it("rejects swapped branch labels even when both labels are present", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
				edge.label ? { ...edge, label: edge.label === "yes" ? "no" : "yes" } : edge,
			),
		};
		const result = evaluateScenarioDiagram(onboardingScenario, candidate);
		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "branch-label:no", passed: true }),
		);
		expect(result.checks).toContainEqual(
			expect.objectContaining({ id: "edge:Scope clear?->Draft typed IR:yes", passed: false }),
		);
	});

	it("accepts a prompt-derived branch alternative only on the required connection", () => {
		const scenario = getFlowchartScenario("pharma-batch-disposition");
		const candidate = {
			...scenario.expectedDiagram,
			edges: scenario.expectedDiagram.edges.map((edge) =>
				edge.id === "specs-pass" ? { ...edge, label: "Passing" } : edge,
			),
		};
		expect(evaluateScenarioDiagram(scenario, candidate).ok).toBe(true);
		const wrongConnection = {
			...candidate,
			edges: candidate.edges.map((edge) =>
				edge.id === "specs-pass" ? { ...edge, target: "reject" } : edge,
			),
		};
		expect(evaluateScenarioDiagram(scenario, wrongConnection).ok).toBe(false);
	});

	it("passes maintained fixture diagrams through the deterministic pipeline", () => {
		const result = evaluateScenarioFixture(onboardingScenario);

		expect(result.ok).toBe(true);
		expect(result.excalidrawValidation.ok).toBe(true);
		expect(result.excalidrawScene.elements.some((element) => element.type === "arrow")).toBe(true);
	});

	it("passes every maintained scenario through the deterministic pipeline", () => {
		expect(flowchartScenarios.length).toBeGreaterThanOrEqual(20);

		for (const scenario of flowchartScenarios) {
			expect(
				scenario.assertions.requiredEdges,
				`${scenario.id}: every expected edge should become a semantic assertion`,
			).toHaveLength(scenario.expectedDiagram.edges.length);

			const result = evaluateScenarioFixture(scenario);

			expect(
				result.ok,
				`${scenario.id}: ${result.checks
					.filter((check) => !check.passed)
					.map((check) => check.message)
					.join(", ")}`,
			).toBe(true);
			expect(
				result.excalidrawValidation.ok,
				`${scenario.id}: ${result.excalidrawValidation.issues
					.map((issue) => issue.message)
					.join(", ")}`,
			).toBe(true);
		}
	});

	it("exports every maintained scenario with move-stable Excalidraw bindings", () => {
		for (const scenario of flowchartScenarios) {
			const result = evaluateScenarioFixture(scenario);
			const elementsById = new Map(
				result.excalidrawScene.elements.map((element) => [element.id, element]),
			);
			const arrows = result.excalidrawScene.elements.filter((element) => element.type === "arrow");

			expect(arrows, scenario.id).toHaveLength(scenario.expectedDiagram.edges.length);

			for (const arrow of arrows) {
				for (const key of ["startBinding", "endBinding"] as const) {
					const originalEndpoint = arrowEndpoint(arrow, key);
					const { elementId, fixedPoint, gap } = binding(arrow, key);
					const shape = elementsById.get(elementId);
					const originalFixedPoint = pointFromBinding(shape, fixedPoint);
					const movedFixedPoint = pointFromBinding(
						shape
							? {
									...shape,
									x: Number(shape.x) + MOVE_DELTA.x,
									y: Number(shape.y) + MOVE_DELTA.y,
								}
							: undefined,
						fixedPoint,
					);

					expect(gap, `${scenario.id}: ${arrow.id} ${key} gap`).toBe(0);
					expectClosePoint(originalFixedPoint, originalEndpoint);
					expectClosePoint(movedFixedPoint, {
						x: originalEndpoint.x + MOVE_DELTA.x,
						y: originalEndpoint.y + MOVE_DELTA.y,
					});
				}
			}
		}
	});

	it("extracts a JSON object from wrapped model output", () => {
		const output = `Here is the JSON:\n${JSON.stringify(onboardingScenario.expectedDiagram)}`;

		expect(extractJsonCandidate(output)).toMatchObject({
			id: onboardingScenario.expectedDiagram.id,
			type: "flowchart",
		});
		expect(evaluateScenarioOutput(onboardingScenario, output).ok).toBe(true);
	});

	it("fails semantic checks when required branches are missing", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
				edge.id === "clear-review" ? { ...edge, label: "maybe" } : edge,
			),
		};

		const result = evaluateScenarioDiagram(onboardingScenario, candidate);

		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				id: "branch-label:no",
				passed: false,
			}),
		);
	});

	it("fails semantic checks when required wiring is changed but labels remain present", () => {
		const candidate = {
			...onboardingScenario.expectedDiagram,
			edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
				edge.id === "clear-review" ? { ...edge, target: "draft" } : edge,
			),
		};

		const result = evaluateScenarioDiagram(onboardingScenario, candidate);

		expect(result.ok).toBe(false);
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				id: "edge:Scope clear?->Review diagram:no",
				passed: false,
			}),
		);
	});
});
