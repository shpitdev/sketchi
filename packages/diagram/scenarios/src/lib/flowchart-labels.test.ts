import { describe, expect, it } from "vitest";

import {
	flowchartBranchRestates,
	flowchartLabelMatches,
	flowchartLabelWords,
	flowchartObjectPhraseMatches,
} from "./flowchart-labels";

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
		["Proceed without review", ["review"]],
		["Do not decline without approval", ["decline"]],
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

	it.each([
		["Does a known fix exist?", ["known fix exists"]],
		["Is identity verified?", ["identity verified"]],
		["Identify a business need", ["need identified"]],
		["Nurse triages urgent symptoms", ["nurse triage"]],
		["Escalate the unstable incident", ["escalates"]],
		["Roll back the canary", ["roll back canary"]],
		["Rollback canary", ["roll back the canary"]],
		["Roll back the unhealthy canary", ["roll back canary"]],
		["Stopped deploys", ["stop deploy"]],
		["Fail", ["failed"]],
		["Roll back the feature after failed internal checks", ["roll back"]],
		["Roll back the feature after internal checks fail", ["roll back"]],
		["Incident resolved without further impact", ["resolved"]],
		["Decline application without exception approval", ["decline application"]],
	])("accepts inflection, compound splits, and extra modifiers in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(true);
	});

	it.each([
		["Known fix", ["known fix exists"]],
		["Does a known fix not exist?", ["known fix exists"]],
		["Roll back the release", ["roll back canary"]],
		["Roll back", ["roll back canary"]],
		["Do not roll back after failed checks", ["roll back"]],
		["Agent processes the app request", ["diagram agent orchestrates"]],
		["Call the model", ["call the OpenAI model"]],
	])("keeps every content word and named entity required in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(false);
	});

	it.each([
		["Healthy", "Canary healthy?", "yes"],
		["Not healthy", "Canary healthy?", "no"],
		["Unhealthy", "Canary healthy?", "no"],
		["Pass", "Tests pass?", "yes"],
		["Fail", "Tests pass?", "no"],
		["Failed scan", "Security scan clean?", "no"],
		["Does not exist", "Account exists?", "no"],
		["Invalid", "Insurance valid?", "no"],
		["Over", "Amount over threshold?", "yes"],
		["Under", "Amount over threshold?", "no"],
		["Under threshold", "Amount over threshold?", "no"],
		["Not over", "Amount over threshold?", "no"],
		["Above", "Inventory below the reorder point?", "no"],
	] as const)("accepts %s as the criterion answer to %s: %s", (label, criterion, answer) => {
		expect(flowchartBranchRestates(label, criterion, answer)).toBe(true);
	});

	it.each([
		["Healthy", "Canary healthy?", "no"],
		["Not healthy", "Canary healthy?", "yes"],
		["Promote", "Canary healthy?", "yes"],
		["Low risk", "Risk high?", "no"],
		["Internal", "Canary healthy?", "no"],
		["Not failed", "Tests pass?", "no"],
		["Not failed", "Tests pass?", "yes"],
		["Not unhealthy", "Canary healthy?", "no"],
		["Not unhealthy", "Canary healthy?", "yes"],
		["Canary", "Canary healthy?", "yes"],
		["Scan", "Security scan clean?", "yes"],
		["Not canary", "Canary healthy?", "no"],
		["", "Canary healthy?", "yes"],
		["Over", "Amount over threshold?", "no"],
		["Under", "Amount over threshold?", "yes"],
		["Not under", "Amount over threshold?", "no"],
		["Under", "Canary healthy?", "no"],
		["Amount", "Amount over threshold?", "yes"],
	] as const)("rejects %s as the criterion answer to %s: %s", (label, criterion, answer) => {
		expect(flowchartBranchRestates(label, criterion, answer)).toBe(false);
	});

	it.each([
		["cookie", "cookies"],
		["movie", "movies"],
		["tie", "ties", "tied"],
		["use", "uses", "used", "using"],
		["setting", "settings"],
		["string", "strings"],
		["embed", "embeds"],
		["ring", "rings"],
		["need", "needs"],
		["one", "ones"],
	])("gives every inflection of %s one stem", (...forms) => {
		expect(new Set(forms.flatMap((form) => flowchartLabelWords(form))).size).toBe(1);
	});

	it.each([
		["Set cookies", ["set cookie"]],
		["Uses cache", ["use cache"]],
		["Update settings", ["update setting"]],
		["Parse strings", ["parse string"]],
	])("matches singular and plural or short-verb forms in %s", (label, alternatives) => {
		expect(flowchartLabelMatches(label, alternatives)).toBe(true);
		expect(flowchartLabelMatches(alternatives[0]!, [label])).toBe(true);
	});

	it("keeps yes whole", () => {
		expect(flowchartLabelWords("Yes")).toEqual(["yes"]);
	});

	it.each([
		["Routine appointment", ["schedules a routine appointment"]],
		["Appointment, routine", ["schedule routine appointment"]],
		["Nurse triage", ["perform nurse triage"]],
		["Intake information", ["collects intake information"]],
		["Answer in Redis", ["store the answer in Redis"]],
	])("accepts %s as the object of a dropped leading verb", (label, alternatives) => {
		expect(flowchartObjectPhraseMatches(label, alternatives)).toBe(true);
	});

	it.each([
		["Appointment", ["schedule routine appointment"]],
		["Cancel routine appointment", ["schedule routine appointment"]],
		["Routine appointment booked", ["schedule routine appointment"]],
		["No routine appointment", ["schedule routine appointment"]],
		["Routine appointment?", ["schedule routine appointment"]],
		["Is the answer cached?", ["return cached answer"]],
		["Answer", ["store the answer in Redis"]],
		["Redis", ["store the answer in Redis"]],
		["Canary", ["deploy canary"]],
		["Triage", ["perform nurse triage"]],
		["Low severity", ["monitoring low severity"]],
		["Day appointment", ["same-day appointment"]],
		["Back canary", ["roll back the canary"]],
		["Substitute supplier", ["unavailable suppliers use a substitute supplier"]],
		["Party waitlist", ["if not, add the party to the waitlist"]],
	])("rejects %s: not exactly the object of a listed leading verb", (label, alternatives) => {
		expect(flowchartObjectPhraseMatches(label, alternatives)).toBe(false);
	});
});
