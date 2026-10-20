import { parseFlowchartDiagram } from "./types/flowchart.js";
import { parseStateMachineDiagram, stateMachineDiagramType } from "./types/state-machine.js";
import connectionRetry from "./fixtures/crossings/connection-retry.js";
import connectionRetryDisconnect from "./fixtures/crossings/connection-retry-disconnect.js";
import contentModeration from "./fixtures/crossings/content-moderation.js";
import groupedExpenseApproval from "./fixtures/crossings/grouped-expense-approval.js";
import incidentEscalation from "./fixtures/crossings/incident-escalation.js";
import incidentEscalationBridge from "./fixtures/crossings/incident-escalation-bridge.js";
import incidentEscalationEarlyBridge from "./fixtures/crossings/incident-escalation-early-bridge.js";
import incidentEscalationSharedResolve from "./fixtures/crossings/incident-escalation-shared-resolve.js";
import mediaPlayer from "./fixtures/crossings/media-player.js";
import mediaPlayerEnded from "./fixtures/crossings/media-player-ended.js";
import namedFinalRetry from "./fixtures/crossings/named-final-retry.js";
import orderLifecycle from "./fixtures/crossings/order-lifecycle.js";
import orderLifecycleEnded from "./fixtures/crossings/order-lifecycle-ended.js";
import patientIntakeScheduling from "./fixtures/crossings/patient-intake-scheduling.js";
import procurementVendorApproval from "./fixtures/crossings/procurement-vendor-approval.js";
import procurementVendorApprovalLegal from "./fixtures/crossings/procurement-vendor-approval-legal.js";
import restaurantWaitlist from "./fixtures/crossings/restaurant-waitlist.js";
import restaurantWaitlistRecheck from "./fixtures/crossings/restaurant-waitlist-recheck.js";
import subscriptionRenewalDunning from "./fixtures/crossings/subscription-renewal-dunning.js";
import subscriptionRenewalGrace from "./fixtures/crossings/subscription-renewal-grace.js";

function flowchart(fixture: object) {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	});
}

/**
 * Generated flowcharts whose layouts drew avoidable crossings: long branches
 * that skip ranks, nested loops on one side, two arrivals that swap at their
 * target, and a branch that ran tangent to a terminal it passed.
 */
export const crossingFixtures = {
	"incident-escalation": flowchart(incidentEscalation),
	"incident-escalation-bridge": flowchart(incidentEscalationBridge),
	"incident-escalation-early-bridge": flowchart(incidentEscalationEarlyBridge),
	"incident-escalation-shared-resolve": flowchart(incidentEscalationSharedResolve),
	"subscription-renewal-dunning": flowchart(subscriptionRenewalDunning),
	"subscription-renewal-grace": flowchart(subscriptionRenewalGrace),
	"patient-intake-scheduling": flowchart(patientIntakeScheduling),
	"procurement-vendor-approval": flowchart(procurementVendorApproval),
	"procurement-vendor-approval-legal": flowchart(procurementVendorApprovalLegal),
	"restaurant-waitlist": flowchart(restaurantWaitlist),
	"restaurant-waitlist-recheck": flowchart(restaurantWaitlistRecheck),
	"grouped-expense-approval": flowchart(groupedExpenseApproval),
	"content-moderation": flowchart(contentModeration),
};

function stateMachine(fixture: object) {
	return parseStateMachineDiagram({ ...fixture, type: stateMachineDiagramType });
}

/**
 * Generated state machines whose layouts drew avoidable crossings, a guard
 * label between two lines, a return label nearer another line than its own or
 * a label moved out past the drawing, each laid out in whichever direction
 * reads better.
 */
export const crossingStateMachines = {
	"media-player": stateMachine(mediaPlayer),
	"media-player-ended": stateMachine(mediaPlayerEnded),
	"connection-retry": stateMachine(connectionRetry),
	"connection-retry-disconnect": stateMachine(connectionRetryDisconnect),
	"order-lifecycle": stateMachine(orderLifecycle),
	"order-lifecycle-ended": stateMachine(orderLifecycleEnded),
	"named-final-retry": stateMachine(namedFinalRetry),
};
