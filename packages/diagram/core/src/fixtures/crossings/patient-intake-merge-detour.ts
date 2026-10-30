/** Patient intake whose self-pay branch wound down past routine scheduling and round into its far side, though the side facing it was free: two stacked decisions both end there. Round 29 (Sonnet), drawn alike in four of five samples. */
export default {
	id: "patient-intake-scheduling",
	title: "Patient Intake Scheduling",
	nodes: [
		{
			id: "req",
			label: "Patient requests appointment",
			kind: "start",
		},
		{
			id: "intake",
			label: "Collect intake information",
			kind: "process",
		},
		{
			id: "urgent",
			label: "Urgent symptoms?",
			kind: "decision",
		},
		{
			id: "triage",
			label: "Nurse triage",
			kind: "process",
		},
		{
			id: "same",
			label: "Schedule same-day appointment",
			kind: "end",
		},
		{
			id: "ins",
			label: "Insurance valid?",
			kind: "decision",
		},
		{
			id: "routine",
			label: "Schedule routine appointment",
			kind: "end",
		},
		{
			id: "self",
			label: "Patient accepts self-pay?",
			kind: "decision",
		},
		{
			id: "bill",
			label: "Refer to billing",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "req",
			target: "intake",
		},
		{
			id: "edge-2",
			source: "intake",
			target: "urgent",
		},
		{
			id: "edge-3",
			source: "urgent",
			target: "triage",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "triage",
			target: "same",
		},
		{
			id: "edge-5",
			source: "urgent",
			target: "ins",
			label: "No",
		},
		{
			id: "edge-6",
			source: "ins",
			target: "routine",
			label: "Yes",
		},
		{
			id: "edge-7",
			source: "ins",
			target: "self",
			label: "No",
		},
		{
			id: "edge-8",
			source: "self",
			target: "routine",
			label: "Yes",
		},
		{
			id: "edge-9",
			source: "self",
			target: "bill",
			label: "No",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
