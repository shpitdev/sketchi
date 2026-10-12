import { describe, expect, it } from "vitest";

import { flowchartLabelMatches } from "./flowchart-labels";

describe("prompt-grounded flowchart labels", () => {
	it.each([
		["MONITOR low-severity\nincident", ["low severity"]],
		["Is scope clear?", ["scope"]],
		["Send customer comms", ["customer communications"]],
		["Rollback feature", ["roll back"]],
		["Investigate retesting", ["retest", "investigation"]],
		["No: escalate", ["no"]],
		["Passing", ["yes", "passing"]],
		["Incident resolved without further impact", ["resolved"]],
		["No fix: incident resolved", ["resolved"]],
		["Scope: clear?", ["scope clear"]],
		["Not eligible? Reject return", ["reject return"]],
		["Payment fails. Send reminder", ["send reminder"]],
		["Payment fails! Send reminder", ["send reminder"]],
		["Payment fails\nSend reminder", ["send reminder"]],
		["Not eligible → Reject return", ["reject return"]],
		["Not eligible (Reject return)", ["reject return"]],
		["Payment fails - Send reminder", ["send reminder"]],
		["Payment fails – Send reminder", ["send reminder"]],
		["Payment fails / Send reminder", ["send reminder"]],
		["Payment fails and send reminder", ["send reminder"]],
		["Payment fails then send reminder", ["send reminder"]],
		["Payment fails or send reminder", ["send reminder"]],
		["Next.js page receives question", ["Next.js"]],
	])("accepts punctuation, case, and explicit alternatives in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(true);
	});

	it.each([
		["Ineligible", ["eligible"]],
		["Unresolved", ["resolved"]],
		["Yesterday", ["yes"]],
		["Notify", ["no"]],
		["Preview", ["review"]],
		["", [""]],
		["Incident not resolved", ["resolved"]],
		["Incident never resolved", ["resolved"]],
		["Not yet resolved", ["resolved"]],
		["Exception not approved?", ["exception approval", "approved"]],
		["No responder acknowledges alert", ["acknowledges"]],
		["Ignore triage queue", ["triage queue"]],
		["Skip packaging", ["packaging"]],
		["Incident isn't resolved", ["resolved"]],
		["Incident isn’t resolved", ["resolved"]],
		["Incident fails to resolve", ["resolve"]],
		["Incident is unable to fully resolve", ["resolve"]],
		["Incident has not yet been successfully resolved", ["resolved"]],
		["Exception hasn't yet been successfully approved", ["approved"]],
		["Incident not\nresolved", ["resolved"]],
		["Incident hasn't yet\nbeen resolved", ["resolved"]],
		["Incident not - resolved", ["resolved"]],
		["Incident isn't / resolved", ["resolved"]],
		["Incident not (resolved)", ["resolved"]],
	])("does not accept substring or empty matches in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(false);
	});
});
