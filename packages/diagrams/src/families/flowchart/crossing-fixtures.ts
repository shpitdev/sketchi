// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Result } from "effect";
import { parseFlowchartDiagram } from "./document.js";
import contentModeration from "./fixtures/crossings/content-moderation.js";
import expenseOutOfPolicy from "./fixtures/crossings/expense-out-of-policy.js";
import groupedExpenseApproval from "./fixtures/crossings/grouped-expense-approval.js";
import incidentEscalation from "./fixtures/crossings/incident-escalation.js";
import incidentEscalationBridge from "./fixtures/crossings/incident-escalation-bridge.js";
import incidentEscalationEarlyBridge from "./fixtures/crossings/incident-escalation-early-bridge.js";
import incidentEscalationMonitoringMerge from "./fixtures/crossings/incident-escalation-monitoring-merge.js";
import incidentEscalationQueue from "./fixtures/crossings/incident-escalation-queue.js";
import incidentEscalationSharedResolve from "./fixtures/crossings/incident-escalation-shared-resolve.js";
import incidentEscalationStraightEscalation from "./fixtures/crossings/incident-escalation-straight-escalation.js";
import incidentResponseProviderLoop from "./fixtures/crossings/incident-response-provider-loop.js";
import patientIntakeMergeCrossing from "./fixtures/crossings/patient-intake-merge-crossing.js";
import patientIntakeMergeDetour from "./fixtures/crossings/patient-intake-merge-detour.js";
import patientIntakeMergeLong from "./fixtures/crossings/patient-intake-merge-long.js";
import patientIntakeScheduling from "./fixtures/crossings/patient-intake-scheduling.js";
import procurementVendorApproval from "./fixtures/crossings/procurement-vendor-approval.js";
import procurementVendorApprovalLegal from "./fixtures/crossings/procurement-vendor-approval-legal.js";
import restaurantWaitlist from "./fixtures/crossings/restaurant-waitlist.js";
import restaurantWaitlistRecheck from "./fixtures/crossings/restaurant-waitlist-recheck.js";
import restaurantWaitlistTableReady from "./fixtures/crossings/restaurant-waitlist-table-ready.js";
import subscriptionRenewalDunning from "./fixtures/crossings/subscription-renewal-dunning.js";
import subscriptionRenewalGrace from "./fixtures/crossings/subscription-renewal-grace.js";

function flowchart(fixture: object) {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow);
}

/**
 * Generated flowcharts whose layouts drew avoidable crossings: long branches
 * that skip ranks, nested loops on one side, two arrivals that swap at their
 * target, a branch that ran tangent to a terminal it passed, and branches
 * merging into one end that crossed or wound round to its far side.
 */
export const crossingFixtures = {
	"incident-escalation": flowchart(incidentEscalation),
	"incident-escalation-bridge": flowchart(incidentEscalationBridge),
	"incident-escalation-early-bridge": flowchart(incidentEscalationEarlyBridge),
	"incident-escalation-shared-resolve": flowchart(incidentEscalationSharedResolve),
	"incident-escalation-monitoring-merge": flowchart(incidentEscalationMonitoringMerge),
	"subscription-renewal-dunning": flowchart(subscriptionRenewalDunning),
	"subscription-renewal-grace": flowchart(subscriptionRenewalGrace),
	"patient-intake-scheduling": flowchart(patientIntakeScheduling),
	"patient-intake-merge-detour": flowchart(patientIntakeMergeDetour),
	"patient-intake-merge-crossing": flowchart(patientIntakeMergeCrossing),
	"patient-intake-merge-long": flowchart(patientIntakeMergeLong),
	"procurement-vendor-approval": flowchart(procurementVendorApproval),
	"procurement-vendor-approval-legal": flowchart(procurementVendorApprovalLegal),
	"restaurant-waitlist": flowchart(restaurantWaitlist),
	"restaurant-waitlist-recheck": flowchart(restaurantWaitlistRecheck),
	"restaurant-waitlist-table-ready": flowchart(restaurantWaitlistTableReady),
	"incident-response-provider-loop": flowchart(incidentResponseProviderLoop),
	"grouped-expense-approval": flowchart(groupedExpenseApproval),
	"content-moderation": flowchart(contentModeration),
};

/**
 * Live samples whose branches read badly in other ways: an incident flow whose
 * crossings a joint choice of its decisions' vertices removes, one whose
 * escalation should drop straight into the bridge below, and an expense flow
 * whose short branch set its label against its own arrowhead.
 */
export const sideFixtures = {
	"incident-escalation-queue": flowchart(incidentEscalationQueue),
	"incident-escalation-straight-escalation": flowchart(incidentEscalationStraightEscalation),
	"expense-out-of-policy": flowchart(expenseOutOfPolicy),
};
