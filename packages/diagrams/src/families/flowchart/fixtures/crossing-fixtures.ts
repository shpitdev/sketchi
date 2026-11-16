// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Result } from "effect";
import { parseFlowchartDiagram } from "../document.js";
import contentModeration from "./crossings/content-moderation.js";
import expenseOutOfPolicy from "./crossings/expense-out-of-policy.js";
import groupedExpenseApproval from "./crossings/grouped-expense-approval.js";
import incidentEscalation from "./crossings/incident-escalation.js";
import incidentEscalationBridge from "./crossings/incident-escalation-bridge.js";
import incidentEscalationEarlyBridge from "./crossings/incident-escalation-early-bridge.js";
import incidentEscalationMonitoringMerge from "./crossings/incident-escalation-monitoring-merge.js";
import incidentEscalationQueue from "./crossings/incident-escalation-queue.js";
import incidentEscalationSharedResolve from "./crossings/incident-escalation-shared-resolve.js";
import incidentEscalationStraightEscalation from "./crossings/incident-escalation-straight-escalation.js";
import incidentResponseProviderLoop from "./crossings/incident-response-provider-loop.js";
import patientIntakeMergeCrossing from "./crossings/patient-intake-merge-crossing.js";
import patientIntakeMergeDetour from "./crossings/patient-intake-merge-detour.js";
import patientIntakeMergeLong from "./crossings/patient-intake-merge-long.js";
import patientIntakeScheduling from "./crossings/patient-intake-scheduling.js";
import procurementVendorApproval from "./crossings/procurement-vendor-approval.js";
import procurementVendorApprovalLegal from "./crossings/procurement-vendor-approval-legal.js";
import restaurantWaitlist from "./crossings/restaurant-waitlist.js";
import restaurantWaitlistRecheck from "./crossings/restaurant-waitlist-recheck.js";
import restaurantWaitlistTableReady from "./crossings/restaurant-waitlist-table-ready.js";
import subscriptionRenewalDunning from "./crossings/subscription-renewal-dunning.js";
import subscriptionRenewalGrace from "./crossings/subscription-renewal-grace.js";

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
