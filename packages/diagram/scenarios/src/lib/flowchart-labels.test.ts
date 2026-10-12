import { describe, expect, it } from "vitest";

import { flowchartLabelMatches } from "./flowchart-labels";

describe("prompt-grounded flowchart labels", () => {
	it.each([
		["Verify income", ["income verification"]],
		["Upload file", ["file uploaded"]],
		["Expense rejected", ["reject expense"]],
		["Expense paid", ["payment"]],
		["Image builds Docker", ["Docker builds the image"]],
		["File has been uploaded", ["upload file"]],
		["Customer accepts offer?", ["offer accepted"]],
		["Item received and inspected", ["item inspection"]],
		["Parsed successfully?", ["parsing succeeds"]],
		["Package batch", ["packaging"]],
		["Not yet ready keeps waiting", ["not ready keeps waiting"]],
		["Do not verify address; income is verified", ["income verification"]],
		["Monitoring (low severity)", ["monitoring low severity"]],
		["Monitoring: low-severity incident", ["monitoring low severity"]],
		["Monitoring, low severity", ["monitoring low severity"]],
		["Scope: clear?", ["scope clear"]],
		["Otherwise restore content", ["otherwise restore content"]],
		["Payment fails then send reminder", ["then send reminder"]],
	])("accepts content-word lemmas in any order in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(true);
	});

	it.each([
		["Income not verified", ["income verification"]],
		["Do not verify income", ["income verification"]],
		["Income is never verified", ["income verification"]],
		["File not uploaded", ["upload file"]],
		["Expense not paid", ["payment"]],
		["Expense never rejected", ["reject expense"]],
		["Verify address", ["income verification"]],
		["Verification pending", ["income verification"]],
		["The is to", ["the is to"]],
		["Offer not accepted", ["accepts offer"]],
		["Item not inspected", ["item inspection"]],
		["File has not yet been successfully parsed", ["parsing succeeds"]],
		["Not yet been successfully verified income", ["income verification"]],
		["Ready: do not keep waiting", ["not ready keeps waiting"]],
		["Ready do not keep waiting", ["not ready keeps waiting"]],
		["Ready never keep waiting", ["not ready keeps waiting"]],
		["Verify address; income not verified", ["income verification"]],
		["Verify address: income not verified", ["income verification"]],
		["Verify address, income not verified", ["income verification"]],
		["Verify address → income not verified", ["income verification"]],
		["Verify address; income pending", ["income verification"]],
		["Incident resolved without further impact", ["resolved"]],
		["Verify address, income not verified, verification pending", ["income verification"]],
	])("rejects negated, missing, or stopword-only content in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(false);
	});
	it.each([
		["MONITOR low-severity\nincident", ["low severity"]],
		["Is scope clear?", ["scope"]],
		["Send customer comms", ["customer communications"]],
		["Rollback feature", ["roll back"]],
		["Investigate retesting", ["retest", "investigation"]],
		["No: escalate", ["no"]],
		["Passing", ["yes", "passing"]],
		["No fix: incident resolved", ["resolved"]],
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
