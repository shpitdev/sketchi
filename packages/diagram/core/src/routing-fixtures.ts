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

/** Readability regressions from normalized flowchart specs. */
export const routingFixtures = {
	"package-chain": parseFlowchartDiagram({
		...packageChain,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"scope-bypass": parseFlowchartDiagram({
		...scopeBypass,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"rollout-failures": parseFlowchartDiagram({
		...rolloutFailures,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"release-fan-in": parseFlowchartDiagram({
		...releaseFanIn,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"stability-fan-in": parseFlowchartDiagram({
		...stabilityFanIn,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"renewal-retry": parseFlowchartDiagram({
		...renewalRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"cancellation-convergence": parseFlowchartDiagram({
		...cancellationConvergence,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"shared-feedback-returns": parseFlowchartDiagram({
		...sharedFeedbackReturns,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"two-stage-retry": parseFlowchartDiagram({
		...twoStageRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"feedback-chain": parseFlowchartDiagram({
		...feedbackChain,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"multi-stage-rework": parseFlowchartDiagram({
		...multiStageRework,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"feedback-skip-stubs": parseFlowchartDiagram({
		...feedbackSkipStubs,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"decision-feedback": parseFlowchartDiagram({
		...decisionFeedback,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"review-feedback": parseFlowchartDiagram({
		...reviewFeedback,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"wait-retry": parseFlowchartDiagram({
		...waitRetry,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"content-moderation": parseFlowchartDiagram({
		...fixture0,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"data-import-validation": parseFlowchartDiagram({
		...fixture1,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"incident-escalation": parseFlowchartDiagram({
		...fixture2,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"invoice-approval": parseFlowchartDiagram({
		...fixture3,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"loan-application-underwriting": parseFlowchartDiagram({
		...fixture4,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"patient-intake-scheduling": parseFlowchartDiagram({
		...fixture5,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"pharma-batch-disposition": parseFlowchartDiagram({
		...fixture6,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
	"warehouse-reorder": parseFlowchartDiagram({
		...fixture7,
		type: "flowchart",
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	}),
};
