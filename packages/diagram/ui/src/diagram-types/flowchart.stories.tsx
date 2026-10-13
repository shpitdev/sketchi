import type { Meta, StoryObj } from "@storybook/react-vite";

import {
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
	routingFixtures,
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
