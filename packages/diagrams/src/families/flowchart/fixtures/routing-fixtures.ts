// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Result } from "effect";
import { parseFlowchartDiagram } from "../document";
import fixture0 from "./routing/content-moderation";
import fixture1 from "./routing/data-import-validation";
import fixture2 from "./routing/incident-escalation";
import fixture3 from "./routing/invoice-approval";
import fixture4 from "./routing/loan-application-underwriting";
import fixture5 from "./routing/patient-intake-scheduling";
import fixture6 from "./routing/pharma-batch-disposition";
import fixture7 from "./routing/warehouse-reorder";
import reviewFeedback from "./routing/review-feedback";
import waitRetry from "./routing/wait-retry";
import decisionFeedback from "./routing/decision-feedback";
import feedbackSkipStubs from "./routing/feedback-skip-stubs";
import feedbackChain from "./routing/feedback-chain";
import multiStageRework from "./routing/multi-stage-rework";
import twoStageRetry from "./routing/two-stage-retry";
import sharedFeedbackReturns from "./routing/shared-feedback-returns";
import releaseFanIn from "./routing/release-fan-in";
import stabilityFanIn from "./routing/stability-fan-in";
import renewalRetry from "./routing/renewal-retry";
import cancellationConvergence from "./routing/cancellation-convergence";
import packageChain from "./routing/package-chain";
import scopeBypass from "./routing/scope-bypass";
import rolloutFailures from "./routing/rollout-failures";
import cacheLookup from "./routing/cache-lookup";
import expenseReceiptReturn from "./routing/expense-receipt-return";
import incidentResponseRankGap from "./routing/incident-response-rank-gap";
import incidentEscalationLeftToRight from "./routing/incident-escalation-left-to-right";
import incidentFanInChecks from "./routing/incident-fan-in-checks";

/** Readability regressions from normalized flowchart specs. */
export const routingFixtures = {
	"package-chain": parseFlowchartDiagram({
		...packageChain,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"scope-bypass": parseFlowchartDiagram({
		...scopeBypass,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"rollout-failures": parseFlowchartDiagram({
		...rolloutFailures,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"cache-lookup": parseFlowchartDiagram({
		...cacheLookup,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"release-fan-in": parseFlowchartDiagram({
		...releaseFanIn,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"stability-fan-in": parseFlowchartDiagram({
		...stabilityFanIn,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"renewal-retry": parseFlowchartDiagram({
		...renewalRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"cancellation-convergence": parseFlowchartDiagram({
		...cancellationConvergence,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"shared-feedback-returns": parseFlowchartDiagram({
		...sharedFeedbackReturns,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"two-stage-retry": parseFlowchartDiagram({
		...twoStageRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"feedback-chain": parseFlowchartDiagram({
		...feedbackChain,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"multi-stage-rework": parseFlowchartDiagram({
		...multiStageRework,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"feedback-skip-stubs": parseFlowchartDiagram({
		...feedbackSkipStubs,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"decision-feedback": parseFlowchartDiagram({
		...decisionFeedback,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"review-feedback": parseFlowchartDiagram({
		...reviewFeedback,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"wait-retry": parseFlowchartDiagram({
		...waitRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"content-moderation": parseFlowchartDiagram({
		...fixture0,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"data-import-validation": parseFlowchartDiagram({
		...fixture1,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"incident-escalation": parseFlowchartDiagram({
		...fixture2,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"invoice-approval": parseFlowchartDiagram({
		...fixture3,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"loan-application-underwriting": parseFlowchartDiagram({
		...fixture4,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"patient-intake-scheduling": parseFlowchartDiagram({
		...fixture5,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"pharma-batch-disposition": parseFlowchartDiagram({
		...fixture6,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
	"warehouse-reorder": parseFlowchartDiagram({
		...fixture7,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}).pipe(Result.getOrThrow),
};

/**
 * The expense flow whose receipt request returns to a check that sends its
 * branches out by its side vertices, as a generated sample drew it.
 */
export const receiptReturnFlowchart = parseFlowchartDiagram({
	...expenseReceiptReturn,
	type: "flowchart",
	layout: { direction: "TB", edgeRouting: "orthogonal" },
}).pipe(Result.getOrThrow);

/**
 * The incident response flow whose monitoring step steps sideways to the
 * resolution across a narrow rank gap, as a generated sample drew it.
 */
export const rankGapFlowchart = parseFlowchartDiagram({
	...incidentResponseRankGap,
	type: "flowchart",
	layout: { direction: "TB", edgeRouting: "orthogonal" },
}).pipe(Result.getOrThrow);

/**
 * The incident escalation flow asked for left to right, whose yes branch and
 * Monitoring's line both run beneath the queue row into Resolve incident, as a
 * generated sample drew it.
 */
export const leftToRightIncidentFlowchart = parseFlowchartDiagram({
	...incidentEscalationLeftToRight,
	type: "flowchart",
	layout: { direction: "LR", edgeRouting: "orthogonal" },
}).pipe(Result.getOrThrow);

/**
 * The incident response flow whose three stability checks fan their yes and
 * no branches into the same two steps, as generated samples drew it.
 */
export const fanInChecksFlowchart = parseFlowchartDiagram({
	...incidentFanInChecks,
	type: "flowchart",
	layout: { direction: "TB", edgeRouting: "orthogonal" },
}).pipe(Result.getOrThrow);
