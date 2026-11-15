// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Result } from "effect";
import { parseFlowchartDiagram } from "./types/flowchart.js";
import fixture0 from "./fixtures/routing/content-moderation.js";
import fixture1 from "./fixtures/routing/data-import-validation.js";
import fixture2 from "./fixtures/routing/incident-escalation.js";
import fixture3 from "./fixtures/routing/invoice-approval.js";
import fixture4 from "./fixtures/routing/loan-application-underwriting.js";
import fixture5 from "./fixtures/routing/patient-intake-scheduling.js";
import fixture6 from "./fixtures/routing/pharma-batch-disposition.js";
import fixture7 from "./fixtures/routing/warehouse-reorder.js";
import reviewFeedback from "./fixtures/routing/review-feedback.js";
import waitRetry from "./fixtures/routing/wait-retry.js";
import decisionFeedback from "./fixtures/routing/decision-feedback.js";
import feedbackSkipStubs from "./fixtures/routing/feedback-skip-stubs.js";
import feedbackChain from "./fixtures/routing/feedback-chain.js";
import multiStageRework from "./fixtures/routing/multi-stage-rework.js";
import twoStageRetry from "./fixtures/routing/two-stage-retry.js";
import sharedFeedbackReturns from "./fixtures/routing/shared-feedback-returns.js";
import releaseFanIn from "./fixtures/routing/release-fan-in.js";
import stabilityFanIn from "./fixtures/routing/stability-fan-in.js";
import renewalRetry from "./fixtures/routing/renewal-retry.js";
import cancellationConvergence from "./fixtures/routing/cancellation-convergence.js";
import packageChain from "./fixtures/routing/package-chain.js";
import scopeBypass from "./fixtures/routing/scope-bypass.js";
import rolloutFailures from "./fixtures/routing/rollout-failures.js";
import cacheLookup from "./fixtures/routing/cache-lookup.js";
import expenseReceiptReturn from "./fixtures/routing/expense-receipt-return.js";
import incidentResponseRankGap from "./fixtures/routing/incident-response-rank-gap.js";
import incidentEscalationLeftToRight from "./fixtures/routing/incident-escalation-left-to-right.js";
import incidentFanInChecks from "./fixtures/routing/incident-fan-in-checks.js";

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
