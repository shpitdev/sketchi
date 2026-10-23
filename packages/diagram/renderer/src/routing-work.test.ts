import * as diagramCore from "@sketchi/diagram-core";
import {
	classFixture,
	classStressFixtures,
	crossingFixtures,
	crossingStateMachines,
	erFixture,
	erStressFixtures,
	flowchartFixture,
	laneFixtures,
	laneStressFixtures,
	orgChartEr,
	parseIntermediateDiagram,
	zoneFixtures,
	zoneStressFixtures,
} from "@sketchi/diagram-core";
import { describe, expect, it, vi } from "vitest";
import { arrowCrossings, renderIntermediateDiagram } from "./scene";
import { renderErDiagram } from "./er";
import { renderClassDiagram } from "./class-diagram";
import { renderStateMachineDiagram } from "./state-machine";

// Count the segment geometry checks the router makes through diagram-core, and
// the node labels it measures: every layout sizes each node from its label. Both
// counts are deterministic, so they bound routing work without a wall-clock timer.
const work = vi.hoisted(() => ({ checks: 0, measures: 0 }));
vi.mock("@sketchi/diagram-core", async (importOriginal) => {
	const core = await importOriginal<typeof diagramCore>();
	const counted =
		<Args extends unknown[], Result>(check: (...args: Args) => Result) =>
		(...args: Args): Result => {
			work.checks += 1;
			return check(...args);
		};
	return {
		...core,
		segmentCrossesBoundsInterior: counted(core.segmentCrossesBoundsInterior),
		segmentsFromPoints: counted(core.segmentsFromPoints),
		segmentsOverlapInterior: counted(core.segmentsOverlapInterior),
		wrapTextToUnits: (...args: Parameters<typeof core.wrapTextToUnits>) => {
			work.measures += 1;
			return core.wrapTextToUnits(...args);
		},
	};
});

/** A dense release flow: 24 nodes, 32 labeled edges, five decisions with returns. */
const denseRelease = parseIntermediateDiagram({
	...flowchartFixture,
	id: "production-release-rollback",
	nodes: [
		["start", "Start", "start"],
		["ci_build", "CI Build", "process"],
		["ci_gate", "CI Gate", "decision"],
		["security_scan", "Security Scan", "process"],
		["scan_gate", "Scan Gate", "decision"],
		["vuln_gate", "Vuln Gate", "decision"],
		["deploy_staging", "Deploy Staging", "process"],
		["smoke_staging", "Smoke Staging", "process"],
		["staging_gate", "Staging Gate", "decision"],
		["fix_code", "Fix Code", "process"],
		["canary_deploy", "Canary Deploy", "process"],
		["canary_gate", "Canary Gate", "decision"],
		["full_rollout", "Full Rollout", "process"],
		["monitor", "Monitor", "process"],
		["incident_gate", "Incident Gate", "decision"],
		["severity_gate", "Severity Gate", "decision"],
		["page_oncall", "Page Oncall", "process"],
		["mitigate", "Mitigate", "process"],
		["mitigation_gate", "Mitigation Gate", "decision"],
		["rollback", "Rollback", "process"],
		["rollback_gate", "Rollback Gate", "decision"],
		["manual_recovery", "Manual Recovery", "process"],
		["postmortem", "Postmortem", "process"],
		["done", "Done", "end"],
	].map(([id, label, kind]) => ({ id, label, kind })),
	edges: [
		["start", "ci_build", "trigger"],
		["ci_build", "ci_gate", "tests done"],
		["ci_gate", "security_scan", "green"],
		["ci_gate", "fix_code", "red"],
		["fix_code", "ci_build", "rebuild"],
		["security_scan", "scan_gate", "scan"],
		["scan_gate", "deploy_staging", "clean"],
		["scan_gate", "vuln_gate", "vulns"],
		["vuln_gate", "done", "abort"],
		["vuln_gate", "fix_code", "patch"],
		["deploy_staging", "smoke_staging", "deploy"],
		["smoke_staging", "staging_gate", "verify"],
		["staging_gate", "canary_deploy", "healthy"],
		["staging_gate", "fix_code", "failed"],
		["canary_deploy", "canary_gate", "5 percent"],
		["canary_gate", "full_rollout", "ok"],
		["canary_gate", "rollback", "regression"],
		["full_rollout", "monitor", "observe"],
		["monitor", "incident_gate", "signals"],
		["incident_gate", "done", "stable"],
		["incident_gate", "severity_gate", "incident"],
		["severity_gate", "page_oncall", "sev1"],
		["severity_gate", "mitigate", "low sev"],
		["page_oncall", "mitigate", "triage"],
		["mitigate", "mitigation_gate", "mitigate"],
		["mitigation_gate", "monitor", "worked"],
		["mitigation_gate", "rollback", "missed SLA"],
		["rollback", "rollback_gate", "rollback"],
		["rollback_gate", "postmortem", "restored"],
		["rollback_gate", "manual_recovery", "still failing"],
		["manual_recovery", "rollback_gate", "re-verify"],
		["postmortem", "done", "closed"],
	].map(([source, target, label], index) => ({ id: `edge-${index + 1}`, source, target, label })),
});

describe("routing work", () => {
	// Measured: 3.65M checks TB and 6.57M LR with A* grid search, aligned ports,
	// corridor-aware fallbacks, the drawn layout's arrival polish (3.40M and 3.19M
	// before it), a last pass moving lines clear of every node they still pass
	// too closely (5.07M LR before it) and ends moved off rounded corners (5.71M
	// LR before). Rescanning every routed segment on each grid-search step
	// (aa01b3f1) took 29.4M TB.
	it.each([
		["TB", 6_000_000],
		["LR", 9_000_000],
	] as const)("bounds segment checks for a dense %s release flow", (direction, limit) => {
		work.checks = 0;
		const scene = renderIntermediateDiagram({
			...denseRelease,
			layout: { ...denseRelease.layout, direction },
		});
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(32);
		expect(work.checks).toBeGreaterThan(0);
		expect(work.checks).toBeLessThan(limit);
	});
});

/**
 * A dense incident response: 16 nodes, 19 edges, four decisions, one with three
 * severity branches, and two returns. From the Code Mode runtime's dense export.
 */
const denseIncident = parseIntermediateDiagram({
	...flowchartFixture,
	id: "incident-escalation-ops",
	nodes: [
		["alert_received", "Alert Received", "start"],
		["triage", "Triage & Deduplicate", "process"],
		["is_actionable", "Actionable Signal?", "decision"],
		["auto_close", "Auto-Close / Suppress", "end"],
		["severity", "Assess Severity", "decision"],
		["sev1_page", "Page On-Call (SEV1)", "process"],
		["sev2_assign", "Assign Owner (SEV2)", "process"],
		["sev3_queue", "Queue Backlog (SEV3)", "process"],
		["incident_bridge", "Open Incident Bridge", "process"],
		["investigate", "Investigate Root Cause", "process"],
		["mitigated", "Mitigated?", "decision"],
		["reassess", "Reassess Severity", "process"],
		["comms", "Notify Stakeholders", "process"],
		["monitor", "Stable After Monitoring?", "decision"],
		["postmortem", "Write Postmortem", "process"],
		["resolved", "Incident Resolved", "end"],
	].map(([id, label, kind]) => ({ id, label, kind })),
	edges: [
		["alert_received", "triage"],
		["triage", "is_actionable"],
		["is_actionable", "auto_close", "no"],
		["is_actionable", "severity", "yes"],
		["severity", "sev1_page", "SEV1"],
		["severity", "sev2_assign", "SEV2"],
		["severity", "sev3_queue", "SEV3"],
		["sev1_page", "incident_bridge"],
		["sev2_assign", "incident_bridge"],
		["incident_bridge", "investigate"],
		["sev3_queue", "investigate"],
		["investigate", "mitigated"],
		["mitigated", "comms", "yes"],
		["mitigated", "reassess", "no"],
		["reassess", "severity", "re-triage"],
		["comms", "monitor"],
		["monitor", "postmortem", "stable"],
		["monitor", "investigate", "regressed"],
		["postmortem", "resolved"],
	].map(([source, target, label], index) => ({
		id: `edge-${index + 1}`,
		source,
		target,
		...(label ? { label } : {}),
	})),
	layout: { direction: "TB", edgeRouting: "orthogonal" },
});

describe("branch side work", () => {
	// Every layout sizes each of the 16 nodes from its label twice, and the
	// render sizes them once before laying out: 7 sizings (224 measurements)
	// on db5ae02e and here, 2.52M and 2.56M checks. On 9b76e52f the crossing
	// repair had moved the severity check's branches, so the branch-side pass
	// laid out the arranged layout's own assignment again and completed it
	// through three repair layouts, back to the drawn layout: 11 sizings (352)
	// and 4.81M checks for the same drawing.
	it("completes no branch assignment the arranged layout already makes", () => {
		work.checks = 0;
		work.measures = 0;
		const scene = renderIntermediateDiagram(denseIncident);
		expect(scene.elements.filter((element) => element.type === "arrow")).toHaveLength(19);
		expect(work.measures).toBeLessThanOrEqual(7 * 2 * 16);
		expect(work.checks).toBeLessThan(3_000_000);
	});
});

describe("crossing repair work", () => {
	// The generated corpus includes the named-final retry case. Side changes are
	// screened by rerouting only the edges they touch before laying the diagram
	// out in full. Measured 14.05M: 8.88M as before, the rest to choose decision
	// branch vertices (each candidate completed through the arrowhead repair, and
	// tried wherever a decision's branches were flawed before the crossing repair
	// moved them), screen moves onto a decision's free vertex, polish arrivals and
	// move ends off rounded corners (13.98M before).
	// 14.46M while the branch-side pass also completed the arranged layout's own
	// assignment again.
	it("bounds segment checks for the generated diagrams it repairs", () => {
		work.checks = 0;
		for (const fixture of Object.values(crossingFixtures)) renderIntermediateDiagram(fixture);
		for (const machine of Object.values(crossingStateMachines)) renderStateMachineDiagram(machine);
		expect(work.checks).toBeLessThan(15_000_000);
	});
});

describe("crossed paired-return work", () => {
	// Measured: 695,377 checks versus 597,148 paired-only and 807,097 for the
	// removed whole-machine fallback. Only crossed pairs may lose their lanes.
	it("bounds the crossed named-final retry repair", () => {
		work.checks = 0;
		const scene = renderStateMachineDiagram(crossingStateMachines["named-final-retry"]);
		expect(
			scene.elements.some((element) => element.type === "text" && element.text === "Failed"),
		).toBe(true);
		expect(work.checks).toBeGreaterThan(0);
		expect(work.checks).toBeLessThan(800_000);
		expect(arrowCrossings(scene.elements.filter((element) => element.type === "arrow"))).toBe(0);
	});
});

describe("ER routing work", () => {
	// Measured: 7.1k checks for the two fixtures and 3.46M for the twenty-table
	// marketplace, its candidate placements each routed in full.
	it("bounds segment checks for typical schemas and the twenty-table stress schema", () => {
		work.checks = 0;
		renderErDiagram(erFixture);
		renderErDiagram(orgChartEr);
		const small = work.checks;
		work.checks = 0;
		renderErDiagram(erStressFixtures.marketplace);
		const large = work.checks;
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(50_000);
		expect(large).toBeLessThan(6_000_000);
	});
});

describe("class diagram routing work", () => {
	// Measured: 8.9k checks for the shapes and self-reference models and 363k for the
	// twenty-class library, its candidate placements each routed in full.
	it("bounds segment checks for a small model and the twenty-class stress model", () => {
		work.checks = 0;
		renderClassDiagram(classFixture);
		renderClassDiagram(classStressFixtures.selfReference);
		const small = work.checks;
		work.checks = 0;
		renderClassDiagram(classStressFixtures.library);
		const large = work.checks;
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(30_000);
		expect(large).toBeLessThan(1_500_000);
	});
});

describe("swimlane routing work", () => {
	// Measured: 1.86M checks for the five lane fixtures in LR and TB, and 6.18M
	// for the two stress cases (six lanes and thirty steps, and loops across four
	// lanes). Rows of lanes past 2.3:1 lay out again to tighten: the six-lane row
	// three times (2.56M, from 0.96M), incident response and the single lane twice.
	it("bounds segment checks for the lane fixtures and stress cases", () => {
		const render = (fixtures: Record<string, diagramCore.IntermediateDiagram>) => {
			work.checks = 0;
			for (const fixture of Object.values(fixtures))
				for (const direction of ["LR", "TB"] as const)
					renderIntermediateDiagram({
						...fixture,
						layout: { direction, edgeRouting: "orthogonal" },
					});
			return work.checks;
		};
		const small = render(laneFixtures);
		const large = render(laneStressFixtures);
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(2_500_000);
		expect(large).toBeLessThan(7_000_000);
	});
});

describe("zone routing work", () => {
	// Measured: 2.12M checks for the four zone fixtures in LR and TB, and 16.4M for
	// the two stress cases (zones four deep across two availability zones, and
	// thirty services in eight zones), each wrapped where too long for one row or
	// column; 2.08M and 16.3M before ends moved off rounded corners, 1.96M and
	// 14.6M before the drawn layout's arrival polish. Testing
	// each grid step only against the shapes its line runs through took the
	// stress cases from 27.5M.
	it("bounds segment checks for the zone fixtures and stress cases", () => {
		const render = (fixtures: Record<string, diagramCore.IntermediateDiagram>) => {
			work.checks = 0;
			for (const fixture of Object.values(fixtures))
				for (const direction of ["LR", "TB"] as const)
					renderIntermediateDiagram({
						...fixture,
						layout: { direction, edgeRouting: "orthogonal" },
					});
			return work.checks;
		};
		const small = render(zoneFixtures);
		const large = render(zoneStressFixtures);
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(2_300_000);
		expect(large).toBeLessThan(18_000_000);
	});
});
