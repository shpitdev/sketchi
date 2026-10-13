import { parseFlowchartDiagram } from "./types/flowchart.js";
import fixture0 from "./fixtures/routing/content-moderation.json";
import fixture1 from "./fixtures/routing/data-import-validation.json";
import fixture2 from "./fixtures/routing/incident-escalation.json";
import fixture3 from "./fixtures/routing/invoice-approval.json";
import fixture4 from "./fixtures/routing/loan-application-underwriting.json";
import fixture5 from "./fixtures/routing/patient-intake-scheduling.json";
import fixture6 from "./fixtures/routing/pharma-batch-disposition.json";
import fixture7 from "./fixtures/routing/warehouse-reorder.json";

/** Readability regressions from normalized flowchart specs. */
export const routingFixtures = {
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
