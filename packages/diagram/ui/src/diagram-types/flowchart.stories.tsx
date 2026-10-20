import type { Meta, StoryObj } from "@storybook/react-vite";

import {
	describedArchitectureFlowchart,
	flowchartFixture,
	groupFixtures,
	laneFixtures,
	pharmaBatchDispositionFlowchart,
	routingFixtures,
	zoneFixtures,
} from "@sketchi/diagram-core";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Flowchart",
	component: GenerationWorkspace,
	args: {
		diagram: flowchartFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const PharmaBatchDisposition: Story = {
	args: {
		diagram: pharmaBatchDispositionFlowchart,
	},
};

export const GroupedApproval: Story = {
	args: { diagram: groupFixtures["grouped-approval"] },
};

export const GroupedThreeZoneService: Story = {
	args: { diagram: groupFixtures["three-zone-service"] },
};

export const GroupedMixedMembership: Story = {
	args: { diagram: groupFixtures["mixed-membership"] },
};

export const SwimlaneOrderFulfilment: Story = {
	args: { diagram: laneFixtures["order-fulfilment"] },
};

export const SwimlaneHiring: Story = {
	args: { diagram: laneFixtures.hiring },
};

export const SwimlaneIncidentResponse: Story = {
	args: { diagram: laneFixtures["incident-response"] },
};

export const ZonesAwsThreeTier: Story = {
	args: { diagram: zoneFixtures["aws-three-tier"] },
};

/** Short labels with each technology in a subtitle under the label. */
export const ZonesAwsThreeTierDescribed: Story = {
	args: { diagram: describedArchitectureFlowchart },
};

export const ZonesKubernetesCluster: Story = {
	args: { diagram: zoneFixtures["kubernetes-cluster"] },
};

export const ZonesHybridCloud: Story = {
	args: { diagram: zoneFixtures["hybrid-cloud"] },
};

export const RoutingContentModeration: Story = {
	args: { diagram: routingFixtures["content-moderation"] },
};

export const RoutingDataImportValidation: Story = {
	args: { diagram: routingFixtures["data-import-validation"] },
};

export const RoutingIncidentEscalation: Story = {
	args: { diagram: routingFixtures["incident-escalation"] },
};

export const RoutingInvoiceApproval: Story = {
	args: { diagram: routingFixtures["invoice-approval"] },
};

export const RoutingLoanApplicationUnderwriting: Story = {
	args: { diagram: routingFixtures["loan-application-underwriting"] },
};

export const RoutingPatientIntakeScheduling: Story = {
	args: { diagram: routingFixtures["patient-intake-scheduling"] },
};

export const RoutingPharmaBatchDisposition: Story = {
	args: { diagram: routingFixtures["pharma-batch-disposition"] },
};

export const RoutingWarehouseReorder: Story = {
	args: { diagram: routingFixtures["warehouse-reorder"] },
};
