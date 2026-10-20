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

// Count the segment geometry checks the router makes through diagram-core. The
// count is deterministic, so it bounds routing work without a wall-clock timer.
const work = vi.hoisted(() => ({ checks: 0 }));
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
	// Measured: 3.30M checks TB and 3.05M LR with A* grid search, aligned ports and
	// corridor-aware fallbacks. Rescanning every routed segment on each grid-search
	// step (aa01b3f1) took 29.4M TB.
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

describe("crossing repair work", () => {
	// The generated corpus includes the named-final retry case. Keep the existing
	// work ceiling: side changes are screened by rerouting only the edges they
	// touch before laying the diagram out in full. Measured 8.88M: 7.98M for the
	// rest, 0.48M to lay out the shared-resolve incident as before and 0.42M to
	// route its lines clear of the escalation's arrowhead.
	it("bounds segment checks for the generated diagrams it repairs", () => {
		work.checks = 0;
		for (const fixture of Object.values(crossingFixtures)) renderIntermediateDiagram(fixture);
		for (const machine of Object.values(crossingStateMachines)) renderStateMachineDiagram(machine);
		expect(work.checks).toBeLessThan(9_300_000);
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
	// Measured: 1.65M checks for the five lane fixtures in LR and TB, and 4.07M
	// for the two stress cases (six lanes and thirty steps, wrapped into two pools
	// in LR, and loops across four lanes).
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
		expect(large).toBeLessThan(6_000_000);
	});
});

describe("zone routing work", () => {
	// Measured: 1.58M checks for the four zone fixtures in LR and TB, and 13.9M for
	// the two stress cases (zones four deep across two availability zones, and
	// thirty services in eight zones), each wrapped where too long for one row or
	// column. Testing each grid step only against the shapes its line runs through
	// took the stress cases from 27.5M.
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
		expect(small).toBeLessThan(2_000_000);
		expect(large).toBeLessThan(15_000_000);
	});
});
