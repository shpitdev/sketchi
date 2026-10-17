import * as diagramCore from "@sketchi/diagram-core";
import { flowchartFixture, parseIntermediateDiagram } from "@sketchi/diagram-core";
import { describe, expect, it, vi } from "vitest";
import { renderIntermediateDiagram } from "./scene";

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
